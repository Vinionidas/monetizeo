# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

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
