# Arquitetura

Para quem vai mexer no código. O que o app faz e como usar está no [README](../README.md).

## Visão geral

```
navegador (app/)  ──GET/PUT /api/state──►  server.py  ──►  data/state.json      (modo casa)
navegador (app/)  ──login + REST──►  Supabase (Postgres + RLS)                  (modo nuvem)
```

- **`app/`** — HTML, CSS e módulos JavaScript puros. Sem framework, sem build, sem dependências.
- **`server.py`** — Python só com a biblioteca padrão. Entrega `app/` e guarda o estado inteiro em um arquivo JSON.
- **`tools/`** — importação de planilha e de backups antigos.
- **`tests/`** — `*.test.mjs` (regras) e `test_server.py` (servidor).

## Decisões e por quê

### Nada é contado duas vezes: estado derivado

O app antigo guardava contadores (parcelas pagas, saldo da dívida, valor guardado na meta) e os atualizava a cada
ação. Bastava apagar um lançamento para tudo sair de sincronia. Agora **só os lançamentos são fonte de verdade**:

| Informação | Calculada de |
|---|---|
| Parcela paga | existe lançamento pago com `source: { kind: 'installment', id, index }` |
| Recorrente já lançado no mês | existe lançamento com `source: { kind: 'recurring', id, period }` |
| Saldo da dívida | `initial` − lançamentos com `source.kind === 'debt'` |
| Guardado na meta | `initial` + lançamentos com `source.kind === 'goal'` |
| Item de cartão pago | existe `invoicePayments` para aquele cartão e mês |
| Saldo da conta | saldo inicial ± lançamentos pagos − faturas pagas com ela |

Apagar ou corrigir um lançamento conserta todo o resto sozinho. `paidBefore` (parcelas) e `initial`
(metas, dívidas) registram o que aconteceu antes de começar a usar o app.

### Previsão não é lançamento

`monthItems(state, mês)` devolve os lançamentos reais do mês **mais** as previsões de recorrentes e parcelas que
ainda não têm lançamento vinculado. Uma previsão só vira lançamento quando alguém confirma. O vínculo é por id,
nunca por nome — no app antigo, qualquer lançamento chamado "Energia" apagava a previsão da conta de luz.

### Mês de competência

`effectiveMonth` decide em que mês um lançamento conta: o mês do recorrente ou da parcela a que está vinculado;
para compra no cartão, o mês de vencimento da fatura (`invoiceMonthFor`); senão, o mês da data.

### `model.js` é puro

Nenhuma função de `app/js/model.js` toca em DOM, rede ou relógio — a data de hoje entra por parâmetro. É por isso
que as regras são testadas com `node --test`, sem navegador.

### Um caminho para gravar

Toda alteração passa por `store.update(fn)`. Ele guarda uma cópia para o "Desfazer", grava e avisa a interface, que
redesenha a tela atual. As telas (`views/`) só leem; os formulários que alteram dados ficam em `actions.js`.

### Sincronização: nada se perde em silêncio

Os dados moram em um de três lugares, atrás da mesma interface (`store.js`): Supabase (`cloud`), `server.py`
(`server`) ou só o navegador (`local`). Em todos os modos remotos vale a mesma regra: **uma alteração do usuário
nunca some sem aviso.**

- **Revisão.** Cada gravação informa a revisão em que se baseou; se outra pessoa gravou antes, o servidor recusa
  (409 no `server.py`; o filtro `rev=eq.N` do `PATCH` no Supabase não altera nenhuma linha).
- **Sem internet.** Antes de qualquer envio, `savePending()` grava no aparelho a base (como estava no servidor)
  e o estado novo. Se a conexão cai ou o app é fechado, a alteração continua lá e é enviada na próxima abertura
  ou assim que a conexão volta. Depois de enviada, a cópia é apagada: o aparelho não guarda o histórico financeiro.
- **Duas pessoas ao mesmo tempo.** `merge.js` junta base, versão local e versão do servidor item por item
  (por `id`): quem mexeu em itens diferentes fica com tudo. Se os dois mexeram no mesmo item, vale a versão de
  quem salvou primeiro, e uma cópia da outra vai para **Ajustes › Alterações que não foram salvas**. Se um lado
  apagou e o outro editou, o item é mantido.
- **Por que juntar o estado e não refazer as ações.** Refazer as funções que alteraram o estado dependeria de
  objetos que ficaram velhos e não sobrevive a um recarregamento; o estado é dado puro e pode ser guardado.

O app consulta a revisão a cada 15 segundos e quando a internet volta. Testes: `tests/merge.test.mjs` (junção) e
`tests/store.test.mjs` (queda de internet, reabertura e conflito contra um Supabase falso em memória).

### Uma casa por pessoa

`household_members` tem índice único em `user_id`, e `join_household` recusa quem já tem casa (`ja_tem_casa`).
O app confere antes e o banco garante depois, mesmo que alguém chame a função direto. `myHousehold` ordena por
data de criação para nunca depender da ordem do banco.

### Backups e limites do plano gratuito

Os backups diários da tabela `household_backups` ficam no mesmo projeto: ajudam a desfazer um erro, mas não
protegem se o projeto for perdido. Por isso o app lembra de baixar uma cópia a cada 30 dias (Ajustes › Dados).
Projetos gratuitos do Supabase são pausados após cerca de uma semana sem uso e podem ser restaurados pelo painel
([documentação](https://supabase.com/docs/guides/platform/free-project-pausing)).

### Sem service worker

O app depende do servidor para ler os dados, então funcionar offline não ajudaria — e o cache do service worker
antigo era a causa de versões velhas presas no navegador. O servidor responde com `Cache-Control: no-cache`.

### Código de acesso

Com `--lan`, pedidos a `/api/*` vindos de outro aparelho precisam do cabeçalho `X-Monetizeo-Code`. É uma barreira
para visitas no Wi-Fi, não criptografia: o tráfego na rede local é HTTP.

## Formato dos dados

`data/state.json` é `{ "rev": número, "state": {...} }`. Campos de `state` (ver `emptyState` em `model.js`):

- `people` (`name`, `nickname`, `color`, `mascot`, `userId`/`loginEmail` quando ligado ao login), `accounts` (`type`: `bank`, `cash`, `benefit`, `card`, `credit`; `personId` = titular; `opening`, `openingDate` e `balanceSetup` para o saldo inicial), `categories` (`kind`, `group`, `budget` = teto mensal, `estimate` = sobre-teto: margem para urgências acima do teto, usada só nos avisos e nunca na projeção)
- `entries` — `{ id, date, description, amount, type, categoryId, accountId, personId, scope, paid, source?, importId? }`.
  `personId: null` significa "casal"; `scope` é `house` ou `personal`; `loan: { to }` marca um empréstimo a receber
  (devoluções são lançamentos com `source: { kind: 'loan', id }`).
- `recurring` — com `changes` (reajustes "a partir de") e `skips` (meses pulados).
- `installments`, `goals`, `debts`
- `invoicePayments`, `settlements` (acertos entre o casal)
- `ofxPending` (fila de revisão), `ofxIgnored`
- `split` — `{ mode: 'equal' | 'income' | 'custom', shares }`

Datas são sempre strings locais `AAAA-MM-DD` e meses `AAAA-MM`; nunca se usa `toISOString()` para datas.

## Convenções

- Todo texto vindo do usuário passa por `esc()` antes de entrar em HTML.
- Ids vêm de `uid()` — `crypto.randomUUID` não existe em HTTP fora do localhost.
- Cor só carrega significado: verde para pago/positivo, vermelho para atrasado/negativo. Uma única cor de destaque.
- Mudou uma regra em `model.js`? Acrescente o caso em `tests/model.test.mjs`.
