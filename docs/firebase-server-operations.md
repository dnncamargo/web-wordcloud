# Operações Firestore no servidor

## Modelo de acesso

O sistema continua sem autenticação individual. Leituras públicas de clouds, palavras e submissões permanecem no cliente; a criação de uma nova submissão continua pública e limitada ao estado `pending`. Os documentos de palavras aceitas, decisões de submissão, locks de normalização e histórico passam pelos endpoints de domínio em `app/api/clouds/[cloudId]/operations/`.

As rotas manuais não pedem PIN. O PIN compartilhado continua autorizando apenas os endpoints de IA já existentes. A rota `exact-aggregate` só agrega depois que o servidor confirma igualdade do texto normalizado. O cliente não pode declarar que uma ação foi assistida por IA nem escolher o ator registrado.

O histórico contém snapshots necessários para desfazer e não é devolvido ao navegador. A rota de leitura devolve até 30 resumos. Um undo restaura os documentos na mesma transação e cria um evento `undo`; não atualiza nem remove o evento original. Locks e alterações nas palavras são gravados na mesma transação.

## Configuração local

O arquivo `firebase.json` aponta apenas para o Emulator Firestore em `127.0.0.1:8080`; os testes usam o projeto sintético `demo-web-wordcloud`. O comando de teste requer Firebase CLI (`firebase`) instalado no ambiente. Para desenvolvimento local, aponte `NEXT_PUBLIC_FIREBASE_PROJECT_ID` e `FIREBASE_ADMIN_PROJECT_ID` para `demo-web-wordcloud` e configure `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. Sem Emulator, o Admin SDK recusa inicialização fora de produção.

Em produção, configure no ambiente de servidor `FIREBASE_ADMIN_PROJECT_ID` e `FIREBASE_SERVICE_ACCOUNT_JSON` com credenciais do projeto pretendido. O projeto no JSON precisa coincidir com o ID configurado. Não use prefixo `NEXT_PUBLIC_` para esses valores. Em Vercel, configure ambos como variáveis server-only para o ambiente-alvo antes de publicar; a chave privada não deve ser enviada ao bundle do navegador.

## Atualização das regras e publicação

`firestore.rules` preserva as permissões baseline fornecidas para `connectionTests`, `settings` e documentos em `clouds`, e adiciona regras específicas: leitura pública de `words` e `newWords`, criação validada de submissões pendentes, negação de mutação direta em `words` e `newWords`, e negação completa a `operations` e `wordNormalizationLocks`. As regras não usam `request.auth` e não alegam que o PIN protege acesso direto.

Antes de publicar, execute `pnpm test:firebase-emulator` e revise as regras do projeto de destino usando o fluxo operacional aprovado pela equipe. Esta alteração não publica regras, configura credenciais nem implanta rotas. Regras mais restritivas podem afetar clientes antigos: publique as rotas compatíveis antes das regras, em janela coordenada, e confirme submissão, revisão, mesclagem, correção, undo e histórico no ambiente de validação.

## Rollback

Se houver falha após publicar a aplicação, restaure a revisão anterior das regras pelo procedimento operacional do projeto. Se a aplicação estiver ativa com regras novas, reverta a aplicação somente depois de confirmar que a revisão anterior do navegador não depende de escrita direta nos documentos agora bloqueados. Os eventos são append-only; não apague o histórico nem restaure snapshots manualmente. Não há migração de dados para desfazer.
