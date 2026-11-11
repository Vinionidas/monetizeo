// Onde os dados ficam.
//
// Com a chave preenchida, o app usa o Supabase (login por e-mail e senha, dados
// na nuvem). Com a chave vazia, usa o servidor local (server.py) como antes.
//
// A chave daqui é a PÚBLICA ("publishable" ou "anon"): ela é feita para ficar
// no app. Nunca coloque aqui a chave "secret"/"service_role" nem a senha do banco.
export const SUPABASE_URL = 'https://ilyvbyyuvdmofnrxyumm.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_7HiZ-daPYmFI3RQNvzX_-w_09r4AN3w';
