#🚀 Sistema de Disparo e Automação de Mensagens via WhatsApp

Sistema completo para gerenciamento de contatos, criação de templates de mensagens com suporte a anexos (imagens/documentos) e agendamento de disparos automáticos via WhatsApp Web.

---

## 🛠️ Pré-requisitos

Antes de começar, você precisará ter instalado em sua máquina:

- [Node.js](https://nodejs.org/) (Versão 18 ou superior)
- [PostgreSQL](https://www.postgresql.org/) (Banco de dados relacional)
- [Git](https://git-scm.com/)

---

## 📦 Passo a Passo de Instalação Local

### 1. Clonar o Repositório
```bash
git clone [https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git](https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git)
cd SEU_REPOSITORIO
```

### 2. Instalar as Dependências
No terminal da pasta do projeto, execute:
```bash
npm install
```

### 3. Configurar o Banco de Dados PostgreSQL
1. Abra o **pgAdmin** ou o terminal do PostgreSQL e crie um banco de dados chamado `brugzap` (ou o nome de sua preferência).
2. Verifique e ajuste as credenciais de conexão do PostgreSQL no arquivo `index.js`:
   ```javascript
   const pool = new Pool({
     user: 'postgres',
     host: 'localhost',
     database: 'brugzap',
     password: 'SUA_SENHA_AQUI',
     port: 5432,
   });
   ```

### 4. Iniciar a Aplicação
Execute o comando abaixo para rodar o servidor:
```bash
node index.js
```

---

## 📲 Como Autenticar no WhatsApp

1. Ao rodar o comando `node index.js`, um **QR Code** será exibido no terminal.
2. Abra o WhatsApp no seu celular -> **Aparelhos Conectados** -> **Conectar um aparelho**.
3. Aponte a câmera para o QR Code no terminal até confirmar a conexão.

---

## 🖥️ Acessando o Painel de Controle

Abra o seu navegador web e acesse:
```text
http://localhost:3000
```

### Funcionalidades do Painel:
- **Contatos:** Cadastro de números com DDI + DDD (Ex: `5547999999999`).
- **Grupos:** Organização de contatos por categorias/tags.
- **Templates:** Criação de mensagens personalizadas com a tag `{nome}` e upload de imagens/anexos.
- **Agendamentos:** Programação de disparos por lote em horários específicos.

---

## 🔄 Como Trocar de Número do WhatsApp

Para ler um novo QR Code e alterar o celular conectado:
1. Acesse no navegador: `http://localhost:3000/logout`
2. Reinicie a aplicação no terminal digitando `Ctrl + C` e rodando `node index.js` novamente.
