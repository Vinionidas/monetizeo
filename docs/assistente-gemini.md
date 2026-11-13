# Assistente Gemini no Monetizeo

## Escopo da primeira versão

- Chat de consulta sobre o mês selecionado e o mês anterior.
- A resposta usa apenas totais calculados pelo Monetizeo: receitas, gastos, sobra prevista, categorias e contas pendentes agrupadas por data.
- Não envia descrições de compras, nomes de pessoas ou contas. Nomes personalizados de categorias podem ser enviados junto com seus totais.
- Não cria, altera ou apaga lançamentos. O histórico do chat existe somente na memória da página e some ao recarregar.
- Disponível quando o Monetizeo está no modo nuvem e o usuário entrou na conta. O resumo é enviado somente após consentimento explícito.

## Configuração do Gemini

1. Crie uma chave no Google AI Studio.
2. No projeto Monetizeo do Supabase, abra **Edge Functions → Secrets**.
3. Cadastre `GEMINI_API_KEY` com a chave criada. Não coloque a chave no Git, no JavaScript do navegador, em issue ou em mensagem.
4. Publique a função `monetizeo-assistant` com validação de JWT habilitada. A função deve exigir sessão autenticada; não habilite acesso anônimo.
5. Publique o front-end e confirme que a origem real do site está na lista `ALLOWED_ORIGINS` em `supabase/functions/monetizeo-assistant/index.ts`.

O segredo pode ser cadastrado também pela CLI do Supabase (`supabase secrets set GEMINI_API_KEY=...`). Segredos remotos ficam disponíveis para as Edge Functions sem reimplantá-las. Para desenvolvimento local, use `supabase/functions/.env` e mantenha esse arquivo fora do Git.

## Custos e limites

O código usa `gemini-3.1-flash-lite` via Gemini API. O custo efetivo depende da tabela e das cotas vigentes da API; o nível gratuito pode ter limites por projeto/modelo e condições de uso de dados próprias. Verifique a página atual de preços e termos do Google antes de liberar para outros usuários. O backend transforma resposta 429 em uma mensagem de cota atingida.

As Edge Functions também estão sujeitas ao plano e aos limites do Supabase. O chat faz uma chamada à função e uma chamada ao Gemini por pergunta. Não há uma tarifa fixa adicionada pelo Monetizeo; podem existir custos se o uso ultrapassar cotas gratuitas.

## Privacidade e segurança

- A chave do Gemini fica apenas como segredo do servidor Supabase.
- A função só aceita requisições com origem autorizada, método POST e corpo limitado.
- A função limpa e limita os campos do resumo antes de encaminhá-los ao modelo, não consulta o banco de dados e não registra o conteúdo enviado.
- O aceite é guardado no armazenamento local do navegador por usuário; revogar remove esse aceite naquele aparelho.
- Consentimento salvo localmente não substitui a validação no servidor: a Edge Function também exige `consent: true` e deve exigir JWT válido.
- Como o serviço Gemini gratuito pode usar conteúdo para melhoria dos produtos, o aviso precisa permanecer visível antes do consentimento.

## Limitações conhecidas

- Como os dados individuais são omitidos, o assistente não consegue dizer qual compra específica causou uma variação.
- Os números são um retrato do estado local/nuvem carregado no navegador. Não é um extrato bancário nem uma conexão Open Finance.
- A IA pode formular uma explicação incorreta; valores devem ser conferidos no próprio Monetizeo.
- A primeira versão não tem limite de requisições por usuário no backend. Antes de ampliar o acesso, adicionar rate limit para evitar abuso ou consumo inesperado de cota.

## Referências oficiais

- [Segredos e variáveis de ambiente nas Edge Functions do Supabase](https://supabase.com/docs/guides/functions/secrets)
- [Preços e limites do Gemini API](https://ai.google.dev/gemini-api/docs/pricing)
- [Termos do Gemini API](https://ai.google.dev/gemini-api/terms)
