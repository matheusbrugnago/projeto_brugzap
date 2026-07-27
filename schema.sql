-- Limpa tabelas caso existam
DROP TABLE IF EXISTS agendamentos;
DROP TABLE IF EXISTS templates;
DROP TABLE IF EXISTS contatos;

-- Tabela 1: Contatos
CREATE TABLE contatos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    telefone VARCHAR(20) NOT NULL UNIQUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela 2: Modelos de Mensagem (Templates)
CREATE TABLE templates (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(100) NOT NULL,
    conteudo TEXT NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela 3: Agendamentos
CREATE TABLE agendamentos (
    id SERIAL PRIMARY KEY,
    contato_id INT REFERENCES contatos(id) ON DELETE CASCADE,
    template_id INT REFERENCES templates(id) ON DELETE CASCADE,
    data_hora TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'pendente',
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);