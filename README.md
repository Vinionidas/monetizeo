# Monetizeo

Um painel para o casal responder, no mesmo lugar e a qualquer hora:

- **Quanto sobra este mês**, depois de todas as contas — do casal e de cada um.
- **O que vence e o que está atrasado**, com um toque para confirmar o pagamento.
- **Quem paga o quê** nas contas da casa, e quanto um deve acertar com o outro.
- **Quanto vem na fatura** de cada cartão, neste mês e nos próximos.
- **Para onde o saldo vai** nos próximos 24 meses, com recorrentes e parcelas.

Roda no seu computador. Os dados ficam em um arquivo na sua máquina, não em um serviço de terceiros,
e o celular de cada um acessa pelo Wi-Fi de casa.

## Começar

Você precisa só do [Python 3](https://www.python.org/downloads/) instalado.

**Windows:** dê dois cliques em `iniciar.bat`.

**macOS / Linux:**

```sh
./iniciar.sh
```

O navegador abre em `http://127.0.0.1:8765`. Na primeira vez, o app pede os nomes do casal e já está pronto.

### No celular

A janela que abriu mostra um endereço (algo como `http://192.168.0.10:8765`) e um **código de acesso**.
Com o celular no mesmo Wi-Fi, abra o endereço no navegador e digite o código — só na primeira vez.
Para deixar como app, use "Adicionar à tela inicial" no menu do navegador.

O computador precisa estar ligado e com o Monetizeo aberto para o celular acessar.
Se o Windows perguntar sobre o firewall, permita em redes privadas.

Para usar só no computador, sem abrir para a rede: `python server.py`.

## Usar pela internet, sem o computador ligado

O app também funciona com os dados na nuvem, usando um projeto gratuito do [Supabase](https://supabase.com):

1. Crie um projeto e rode o conteúdo de `supabase/schema.sql` no SQL Editor.
2. Em `app/config.js`, preencha a URL do projeto e a chave **pública** (publishable). Nunca a chave secreta.
3. Crie os usuários em Authentication › Users e desligue o cadastro aberto de novos usuários.
4. Publique a pasta `app/` em qualquer hospedagem de site estático com HTTPS. Este repositório já publica
   no GitHub Pages a cada envio para `main` (`.github/workflows/pages.yml`).

Quem entra pela primeira vez cria a casa (podendo levar os dados do servidor local) ou entra na de outra pessoa
com o código de convite, que fica em **Ajustes › Dados e conta**. Com a chave vazia, o app volta ao modo local.

Nenhum dado financeiro fica no repositório nem no site: eles ficam no banco, e as regras de acesso só
entregam a casa a quem está logado e é membro dela.

## Trazer dados que você já tem

Precisa do [Node.js 20+](https://nodejs.org/). A planilha também precisa de `pip install openpyxl`.

```sh
# Planilha "Finanças Pessoais" (.xlsx)
node tools/migrar.mjs "C:/caminho/Financas_Pessoais.xlsx"

# Backup do app antigo (Casa em Ordem)
node tools/migrar.mjs casa-em-ordem-2026-11.json
```

Se já existirem dados, o comando para e pede `--substituir` (o arquivo atual é copiado para `data/backups/` antes).
Feche e abra o Monetizeo depois de importar. Backups do próprio Monetizeo se restauram dentro do app, em **Ajustes › Dados**.

## Como usar no dia a dia

1. **Uma vez:** em *Planejamento*, cadastre o que se repete (salários, aluguel, internet, assinaturas) e as compras parceladas.
   Em *Cartões e contas › Novo*, cadastre cada cartão de crédito (fechamento e vencimento), conta, VA e o titular de cada um.
2. **Quando gastar:** botão *Adicionar*. Marque "Da casa" no que é dividido entre vocês.
3. **Quando pagar uma conta prevista:** toque no círculo ao lado dela e confirme valor, data e conta.
4. **Extrato:** em *Cartões e contas*, escolha o cartão ou a conta e use *Importar OFX*. As transações vão para uma
   fila daquela conta e você confirma uma por uma — nada entra sozinho. Assinaturas, parcelas, pagamento de fatura e
   Pix entre contas de vocês podem ser vinculados para não contar duas vezes.
5. **Fim do mês:** em *Casa*, veja quem deve quanto e registre o acerto.

Tudo o que você apaga ou confirma mostra um **Desfazer** por alguns segundos.

## Seus dados

- Ficam em `data/state.json`. A pasta `data/` nunca entra no Git.
- Uma cópia por dia é guardada em `data/backups/` (últimos 60 dias).
- *Ajustes › Dados › Baixar backup* gera um arquivo para guardar onde quiser.

## Limites conhecidos

- O acesso é pela rede de casa; fora dela, o celular não alcança os dados.
- Não há login: quem tem o código de acesso vê tudo. "Quem usa este aparelho" serve para preencher
  o nome nos lançamentos, não para esconder dados.
- Sem internet, o que você lançar fica guardado no aparelho e é enviado quando a conexão voltar, mesmo que o app
  seja fechado. Se a outra pessoa salvou ao mesmo tempo, as duas alterações são juntadas; só quando os dois mexem
  no mesmo item fica a versão de quem salvou primeiro, e a sua cópia aparece em Ajustes.
- No modo nuvem, os backups diários ficam no mesmo projeto. Baixe uma cópia de vez em quando (o app lembra a cada
  30 dias). Projetos gratuitos do Supabase pausam após cerca de uma semana sem uso e podem ser restaurados pelo painel.

## Desenvolvimento

```sh
npm test                           # regras financeiras (Node)
python -m unittest discover tests  # servidor (Python)
```

Sem dependências e sem etapa de build. A estrutura e as decisões estão em [docs/arquitetura.md](docs/arquitetura.md);
o histórico de versões, em [CHANGELOG.md](CHANGELOG.md).
