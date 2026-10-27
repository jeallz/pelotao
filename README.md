# AulaHub — Portal de atividades

Portal de atividades com professor root, cadastro de alunos por código, envio de um arquivo por atividade, correção com nota de 0 a 100 e ranking pela soma das notas lançadas.

## Requisitos
- Node.js 18 ou superior
- MySQL 8.0+ (recomendado, o ranking usa `RANK()`)

## Instalação
1. Crie o banco e as tabelas executando `schema.sql` no MySQL.
2. Copie `.env.example` para `.env` e configure os dados do MySQL.
3. Troque `SESSION_SECRET`, `ROOT_PASSWORD` e `REGISTRATION_CODE` por valores próprios e fortes.
4. Instale as dependências e inicie:

```bash
npm install
npm start
```

Abra `http://localhost:3000`.

Na primeira inicialização, a aplicação cria a conta root se ainda não existir uma conta com `ROOT_USERNAME` e papel `root`. A senha inicial vem de `ROOT_PASSWORD`. Para alterar a senha depois, altere-a por um fluxo administrativo seguro ou atualize o hash no banco; mudar o `.env` não substitui a senha de uma conta já criada.

## Configuração principal
- `ROOT_USERNAME`: usuário do professor (padrão `professor`)
- `ROOT_PASSWORD`: senha inicial do professor
- `REGISTRATION_CODE`: palavra/código exigido para criar contas de aluno
- `MAX_FILE_MB`: limite de upload em MB (padrão 10)
- `SESSION_SECRET`: segredo usado para assinar sessões

## Funcionalidades
- Login único com redirecionamento por perfil.
- Cadastro de alunos com usuário, senha e código de acesso.
- Criação e exclusão de atividades pelo professor.
- Upload de um arquivo por atividade; um novo envio substitui o anterior e limpa a nota antiga para evitar nota de arquivo diferente.
- Download privado dos arquivos pelo professor autenticado.
- Nota de 0 a 100 e feedback opcional.
- Ranking por soma de notas já lançadas; atividades sem nota não contam.
- Sessões armazenadas no MySQL; senhas com bcrypt.

## Observações importantes antes de publicar na internet
- Use HTTPS e `NODE_ENV=production`.
- Use senhas fortes para MySQL e root, e um `SESSION_SECRET` aleatório longo.
- Restrinja os tipos de arquivo conforme a necessidade real da turma e considere antivírus/inspeção de uploads para uso público.
- Os arquivos ficam em `private_uploads/`, fora da pasta pública, e só podem ser baixados pelo professor autenticado.
- O código de cadastro é compartilhado entre a turma; se ele vazar, qualquer pessoa que o conheça poderá tentar criar uma conta. Troque-o periodicamente.
- O projeto é uma base funcional enxuta, sem recuperação de senha, verificação de e-mail, proteção CSRF dedicada ou rate limiting. Para publicação pública, adicione esses controles e monitore logs/backups.
