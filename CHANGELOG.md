# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [0.13.1] - 2026-11-12

### Alterado
- Mais comparações bobas: 52 itens, 10 começos de frase e mais frases para mês no vermelho.

## [0.13.0] - 2026-11-12

### Alterado
- A sobra por dia na visão geral virou uma comparação boba que muda todo dia ("Dá pra comprar 3 pirulitos por dia...").
  O botão ao lado sorteia outra. Mês no vermelho também ganha frase própria.

## [0.12.0] - 2026-11-12

### Adicionado
- Entrada marcada como **devolução de um gasto** (troco, estorno, dinheiro que voltou por Pix): não conta como renda e
  abate o gasto da categoria — inclusive na divisão da casa, se for "da casa".

## [0.11.0] - 2026-11-12

### Alterado
- Cartões e contas separados em grupos: cartões de crédito; contas e benefícios; carteira, crediários e financiamentos.
  Dinheiro e crediário deixam de aparecer como cartão de plástico.
- Crediário / financiamento tem tela própria: a pagar no mês, saldo devedor e cada compra parcelada com o progresso.

## [0.10.0] - 2026-11-12

### Adicionado
- Aba **Cartões e contas**: um cartão visual por conta (crédito, banco, VA, dinheiro), com cor e titular. Ao escolher um:
  - cartão de crédito: situação da fatura (aberta, fechada, vencida, paga), quando fecha e vence, total, disponível
    do limite, próximas faturas e as compras;
  - conta, VA ou dinheiro: saldo de hoje, quanto entrou e saiu no mês e o extrato (Pix, débitos, créditos e
    pagamentos de fatura).
  - "Importar OFX" ali mesmo, já na conta certa, com a fila de revisão daquela conta.
- O botão Adicionar, nesta aba, já sai na conta escolhida e no nome do titular.
- Resumo com o total das faturas do mês e o saldo de contas e benefícios.

### Corrigido
- Assinatura no cartão caía na fatura do mês da cobrança, não na fatura em que a cobrança fecha
  (ex.: Netflix do dia 15 num cartão que fecha dia 28 ia para a fatura errada).

## [0.9.0] - 2026-11-12

### Adicionado
- Tipo de conta **Vale-alimentação / benefício** (VA/VR): tem saldo próprio, a recarga entra como renda e as compras como gasto.
- **Titular** da conta ou cartão: lançamentos do extrato daquela conta já saem no nome dele (ex.: cartão da esposa).
- Campo "Transferência entre contas nossas ou acerto" no lançamento (a regra existia desde a 0.7.1, mas faltava na tela).
- Na revisão do extrato, opção de vincular à outra ponta de uma transferência entre contas de vocês: as duas saem de gastos e renda.

### Corrigido
- Crédito no extrato do cartão (estorno, devolução) entrava como renda. Agora abate a fatura e o gasto da categoria.
  O "pagamento recebido" no extrato do cartão pode ser reconhecido sem lançar de novo o que já saiu do banco.
- Assinatura e parcela do cartão não podiam ser vinculadas na revisão do extrato do cartão e ficavam em dobro.
- Extratos de contas diferentes com o mesmo código de transação (FITID) eram descartados como duplicados.
  A duplicidade agora é por conta; transações ignoradas antes continuam ignoradas.
- O limite usado do cartão ignorava faturas em aberto com mais de 6 meses.

## [0.8.0] - 2026-11-12

### Alterado
- O "gasto variável estimado" das categorias virou **sobre-teto**: uma margem para urgências acima do teto (limite mensal).
  Passou do teto, dentro da margem: aviso amarelo. Passou do teto + sobre-teto: alerta vermelho na visão geral
  pedindo para reduzir ou compensar em outra categoria.
- A projeção de 12 e 24 meses não soma mais estimativas: usa a mesma base da sobra do mês, então os dois blocos
  passam a bater (antes dezembro aparecia com sobra positiva no resumo e negativa na projeção).

## [0.7.1] - 2026-11-11

### Adicionado
- Lançamentos podem ser marcados como transferência (empréstimo que entrou ou saiu, acerto), ficando fora de gastos e da sobra.

## [0.7.0] - 2026-11-11

### Adicionado
- Rosca de gastos por categoria na visão geral, com o total do mês no centro e o percentual de cada categoria.
  A paleta foi validada para daltonismo nos temas claro e escuro.
- Animações discretas ao entrar numa tela ou trocar de mês: números sobem, barras e a rosca se preenchem.
  Não tocam a cada alteração de dados e respeitam a preferência de movimento reduzido do aparelho.

## [0.6.0] - 2026-11-11

### Adicionado
- Alterações feitas sem internet ficam guardadas no aparelho e são enviadas quando a conexão volta, mesmo que
  o app seja fechado e reaberto.
- Quando duas pessoas salvam ao mesmo tempo, as duas versões são juntadas item por item. Se os dois mexeram no
  mesmo item, fica a versão de quem salvou primeiro e uma cópia da outra vai para Ajustes.
- Uma conta só pode fazer parte de uma casa, no app e no banco.
- Confirmação ao sair da conta com alterações ainda não enviadas.

### Alterado
- Funções internas do banco deixaram de poder ser chamadas de fora (avisos do Security Advisor do Supabase: 8 → 4;
  os 4 restantes são esperados).
- `supabase/schema.sql` inclui o índice de uma casa por pessoa e o trancamento das funções internas.

## [0.5.0] - 2026-11-11

### Adicionado
- Saldo calculado por conta e consolidado na visão geral, com data inicial opcional (início do dia) e saldo
  inicial negativo.
- Vínculo explícito do extrato OFX com a fatura do cartão, sem debitar duas vezes; desfazer devolve a
  transação à fila.
- Pedido de saldo: contas vindas da planilha ou de backups antigos perguntam "quanto tem agora?" em vez de
  mostrar um saldo que não bate com o banco.
- Lembrete de backup no modo nuvem (a cada 30 dias), com opção de adiar.

### Alterado
- O texto do "gasto por dia" agora diz que a sobra inclui receitas ainda previstas.

## [0.4.0] - 2026-11-11

### Adicionado
- A receber de outras pessoas: marque uma despesa como empréstimo e ela sai dos gastos e da sobra
  até ser devolvida; devoluções parciais ou totais são registradas pela visão geral.
- "Dá para gastar até R$ X por dia": a sobra do mês dividida pelos dias que faltam.
- Contas a pagar com filtro por dia de vencimento, destacando os dias já atrasados.
- Nas contas da casa, cada linha mostra "sua parte" para quem está usando o aparelho.

## [0.3.0] - 2026-11-11

### Adicionado
- Modo nuvem (Supabase): login por e-mail e senha, dados compartilhados sem depender do computador de casa,
  código de convite para a segunda pessoa e backup diário no banco. Script em `supabase/schema.sql`.
- Na primeira entrada, opção de levar para a nuvem os dados que estavam no servidor local.
- Publicação automática do app no GitHub Pages a cada envio para `main`.

## [0.2.0] - 2026-11-11

Reescrita completa. O app antigo ("Casa em Ordem") foi substituído por uma base única.

### Adicionado
- Dados compartilhados: um servidor local (`server.py`) guarda tudo em `data/state.json`,
  com backup diário, e os dois celulares da casa veem os mesmos dados pelo Wi-Fi.
- Divisão das contas da casa (meio a meio, proporcional à renda ou percentual fixo) com acerto entre o casal.
- Cartões de crédito com fechamento, vencimento, fatura do mês, pagamento de fatura e limite comprometido.
- Sobra prevista do mês, do casal ou de cada pessoa.
- Orçamento por categoria e gasto variável estimado na projeção.
- Projeção de 24 meses com alerta de saldo acumulado negativo.
- Cadastro, edição e exclusão de metas, dívidas, contas, cartões e categorias.
- "Desfazer" em todas as exclusões e pagamentos.
- Importação da planilha de finanças e de backups do app antigo (`tools/migrar.mjs`).
- Tema claro e escuro; layout próprio para celular.
- Testes automatizados das regras financeiras e do servidor, e CI no GitHub Actions.

### Corrigido
- A importação de extrato OFX agora passa sempre pela fila de revisão, uma transação por vez.
- Pagamento de dívidas e de contas recorrentes previstas, que não funcionavam.
- Data padrão errada à noite (usava horário UTC).
- Parcelas, metas e dívidas não saem mais de sincronia: o estado é calculado pelos lançamentos.
- Recorrente não é mais "substituído" por qualquer lançamento com o mesmo nome.
- Saldo das contas considera só o que foi pago, e cartão não é tratado como conta corrente.
- Textos com aspas ou `<` não quebram mais a tela.
- Versão antiga presa em cache: o service worker foi removido e o servidor manda revalidar sempre.

### Removido
- Dados pessoais de exemplo embutidos no código.

## [0.1.0] - 2026-11-10
- Primeira versão ("Casa em Ordem"): lançamentos, recorrentes, parcelamentos, metas e dívidas em um único aparelho.
