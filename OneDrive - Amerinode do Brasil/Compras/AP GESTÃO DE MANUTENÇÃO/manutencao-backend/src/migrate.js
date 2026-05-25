// Migração automática que roda no boot do servidor.
// Requer DATABASE_URL (string de conexão Postgres do Supabase).
// Se DATABASE_URL não estiver configurada, apenas loga um aviso e segue.

// Itens padrão da tabela de vida útil (seed inicial, só insere se a tabela estiver vazia)
const VIDA_UTIL_PADRAO = [
  ['Óleo do motor','10.000 km','Preventiva','Conforme fabricante e tipo de óleo'],
  ['Filtro de óleo','Troca junto com óleo','Preventiva','Obrigatório em cada troca'],
  ['Filtro de ar motor','10.000 km','Preventiva','Reduz consumo e desgaste'],
  ['Filtro de combustível','10.000 km','Preventiva','Diesel exige atenção maior'],
  ['Filtro cabine/ar-condicionado','10.000 km','Preventiva','Influência climatização'],
  ['Velas de ignição','50.000 km','Preventiva','Iridium pode durar mais'],
  ['Correia dentada','50.000 a 100.000 km','Preventiva','Seguir manual rigorosamente'],
  ['Tensor e rolamentos','Troca junto correia','Preventiva','Evita quebra prematura'],
  ['Correia acessórios','40.000 km','Preventiva','Verificar rachaduras'],
  ['Bateria','2 a 3 anos','Preventiva','Teste em revisões'],
  ['Pastilha de freio','30.000 km','Preventiva','Depende condução'],
  ['Disco de freio','50.000 km','Preventiva','Avaliar espessura'],
  ['Fluido de freio','12 meses','Preventiva','Item de segurança'],
  ['Amortecedores','40.000 km','Preventiva','Influencia estabilidade'],
  ['Molas suspensão','80.000 km','Preventiva','Inspecionar deformações'],
  ['Bandeja suspensão','50.000 km','Corretiva/Preventiva','Verificar folgas'],
  ['Buchas suspensão','50.000 km','Preventiva','Ruídos e vibrações'],
  ['Pivô suspensão','50.000 km','Segurança','Pode causar perda direção'],
  ['Terminal direção','50.000 km','Segurança','Fazer alinhamento'],
  ['Barra axial','50.000 km','Preventiva','Verificar folgas'],
  ['Rolamento roda','70.000 km','Corretiva','Ruído indica desgaste'],
  ['Pneus passeio','60.000 km','Preventiva','Rodízio aumenta vida útil'],
  ['Pneus utilitário/frota','70.000 km','Preventiva','Controle alinhamento'],
  ['Alinhamento','10.000 km','Preventiva','Após impacto também'],
  ['Balanceamento','10.000 km','Preventiva','Evita desgaste irregular'],
  ['Rodízio pneus','10.000 km','Preventiva','Aumenta durabilidade'],
  ['Embreagem','70.000 km','Corretiva','Depende utilização'],
  ['Óleo câmbio automático','50.000 km','Preventiva','Fundamental'],
  ['Radiador limpeza','40.000 km','Preventiva','Evita superaquecimento'],
  ['Fluido arrefecimento','12 a 24 meses','Preventiva','Nunca usar água comum'],
  ['Compressor ar-condicionado','80.000 km','Corretiva','Fazer limpeza sistema'],
  ['Limpador para-brisa','6 a 12 meses','Preventiva','Segurança'],
  ['Catalisador','90.000 km','Corretiva','Emissões e desempenho'],
  ['Revisão geral frota','A cada 10.000 km','Preventiva','Checklist obrigatório']
]

const MIGRATIONS = [
  {
    name: 'add_oficina_e_anexos',
    sql: `
      ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS oficina VARCHAR(150);
      ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS anexos  JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE manutencoes DROP CONSTRAINT IF EXISTS manutencoes_status_check;
      ALTER TABLE manutencoes ADD  CONSTRAINT manutencoes_status_check
        CHECK (status IN ('Em Andamento','Retornado','Cancelado','Orçamento','Aprovado'));
    `
  },
  {
    name: 'create_vida_util',
    sql: `
      CREATE TABLE IF NOT EXISTS vida_util (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        item        VARCHAR(200) NOT NULL,
        vida_util   VARCHAR(100) NOT NULL,
        tipo        VARCHAR(50)  NOT NULL,
        observacao  TEXT,
        ordem       INTEGER       DEFAULT 0,
        created_at  TIMESTAMPTZ   DEFAULT NOW(),
        updated_at  TIMESTAMPTZ   DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_vida_util_tipo ON vida_util(tipo);
    `
  }
]

async function runMigrations() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!url) {
    console.warn('⚠️  DATABASE_URL não configurada — pulando migração automática.')
    console.warn('   Configure a string de conexão Postgres no Railway para auto-migrar.')
    return
  }

  let Client
  try {
    ;({ Client } = require('pg'))
  } catch (e) {
    console.warn('⚠️  pacote "pg" indisponível — pulando migração automática.')
    return
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    for (const m of MIGRATIONS) {
      console.log(`🛠️  rodando migração: ${m.name}`)
      await client.query(m.sql)
    }
    // Seed: popula vida_util com itens padrão se estiver vazia
    try {
      const { rows } = await client.query('SELECT COUNT(*)::int AS c FROM vida_util')
      if (rows[0]?.c === 0) {
        console.log('🌱 populando vida_util com itens padrão...')
        for (let i = 0; i < VIDA_UTIL_PADRAO.length; i++) {
          const [item, vida, tipo, obs] = VIDA_UTIL_PADRAO[i]
          await client.query(
            'INSERT INTO vida_util (item, vida_util, tipo, observacao, ordem) VALUES ($1,$2,$3,$4,$5)',
            [item, vida, tipo, obs, i]
          )
        }
        console.log(`✅ ${VIDA_UTIL_PADRAO.length} itens de vida_util inseridos`)
      }
    } catch (e) {
      console.warn('⚠️  seed vida_util pulado:', e.message)
    }
    console.log('✅ migrações concluídas')
  } catch (err) {
    console.error('❌ erro na migração:', err.message)
  } finally {
    await client.end().catch(() => {})
  }
}

module.exports = { runMigrations }
