// API Serverless - Dashboard Visão 360° 
// Proxy para a API original no manus.space + sincronização com Google Sheets
// Garante compatibilidade total com o frontend

const ORIGINAL_API = 'https://visao360.manus.space/api/trpc';
const SPREADSHEET_ID = '1yF2DnBX5LQLwbf75afFN8mw-RAwN2k7W-Fp8vQCngUs';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=1091180879`;

// Mapeamento de departamentos da planilha para o formato do banco
const DEPT_MAP = {
  'Comercial': 'Comercial',
  'Administrativo - Financeiro': 'Administrativo - Financeiro',
  'Administrativo - Atendimento': 'Administrativo - Atendimento',
  'Administrativo - Sinistro': 'Administrativo - Sinistro',
  'Administrativo e Comercial -Estratégico': 'Administrativo e Comercial -Estratégico',
  'Jurídico': 'Jurídico'
};

function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (inQuotes) {
      if (char === '"' && nextChar === '"') { currentField += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { currentField += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { currentRow.push(currentField.trim()); currentField = ''; }
      else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentRow.push(currentField.trim());
        if (currentRow.length > 1 || currentRow[0] !== '') rows.push(currentRow);
        currentRow = []; currentField = '';
        if (char === '\r') i++;
      } else { currentField += char; }
    }
  }
  if (currentField || currentRow.length > 0) { currentRow.push(currentField.trim()); rows.push(currentRow); }
  return rows;
}

async function fetchSheetData() {
  const response = await fetch(CSV_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Falha ao acessar Google Sheets: ${response.status}`);
  const text = await response.text();
  const rows = parseCSV(text);
  return rows.slice(1).filter(row => row.length >= 4 && row[0]).map(row => ({
    departamento: row[0] || '',
    kpi: row[1] || '',
    descricao: row[2] || '',
    resultadoMes: row[3] || '',
    resultadoMesAnterior: row[4] || '',
    comentario: row[5] || ''
  }));
}

// Meses para gerar dados históricos
const MESES = ['Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro', 'Janeiro', 'Fevereiro'];

function getCurrentMonth() {
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return months[new Date().getMonth()];
}

function generateKpisFromSheet(sheetData) {
  const currentMonth = getCurrentMonth();
  const kpis = [];
  let id = 70001;
  
  for (const row of sheetData) {
    // Dados do mês atual (resultado do mês)
    kpis.push({
      id: id++,
      mes: currentMonth,
      departamento: row.departamento,
      kpi: row.kpi,
      descricao: row.descricao,
      valor: row.resultadoMes,
      comentario: row.comentario || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    // Dados do mês anterior
    const prevMonthIdx = MESES.indexOf(currentMonth) - 1;
    if (prevMonthIdx >= 0 && row.resultadoMesAnterior) {
      kpis.push({
        id: id++,
        mes: MESES[prevMonthIdx],
        departamento: row.departamento,
        kpi: row.kpi,
        descricao: row.descricao,
        valor: row.resultadoMesAnterior,
        comentario: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }
  return kpis;
}

// Tentar buscar da API original primeiro, fallback para Google Sheets
async function proxyOrFallback(procedurePath, queryString, method, body) {
  try {
    // Tentar proxy para a API original
    const url = `${ORIGINAL_API}/${procedurePath}${queryString ? '?' + queryString : ''}`;
    const options = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000) // 5s timeout
    };
    if (method === 'POST' && body) {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (response.ok) {
      const data = await response.json();
      return data;
    }
  } catch (e) {
    // Proxy falhou, usar fallback
    console.log('Proxy failed, using fallback:', e.message);
  }
  
  // Fallback: gerar dados a partir do Google Sheets
  return await handleFallback(procedurePath, queryString);
}

async function handleFallback(procedurePath, queryString) {
  const procedures = procedurePath.split(',').map(p => p.trim()).filter(Boolean);
  
  let inputMap = {};
  if (queryString) {
    const params = new URLSearchParams(queryString);
    const inputParam = params.get('input');
    if (inputParam) {
      try { inputMap = JSON.parse(decodeURIComponent(inputParam)); } catch(e) {}
    }
  }
  
  const sheetData = await fetchSheetData();
  const allKpis = generateKpisFromSheet(sheetData);
  const currentMonth = getCurrentMonth();
  
  const results = [];
  for (let i = 0; i < procedures.length; i++) {
    const proc = procedures[i];
    let procInput = inputMap[String(i)]?.json || null;
    
    try {
      let data;
      switch(proc) {
        case 'dashboard.getAllKpis':
          data = allKpis;
          break;
        case 'dashboard.getKpisByDepartment': {
          const dept = procInput?.departamento || 'Comercial';
          data = allKpis.filter(k => k.departamento === dept || k.departamento.includes(dept));
          break;
        }
        case 'dashboard.getMonthStats':
          data = MESES.filter(m => MESES.indexOf(m) <= MESES.indexOf(currentMonth)).map(mes => {
            const monthKpis = allKpis.filter(k => k.mes === mes);
            return {
              mes,
              totalKpis: sheetData.length,
              kpisPreenchidos: monthKpis.length,
              percentualPreenchimento: Math.round((monthKpis.length / sheetData.length) * 100),
              status: monthKpis.length >= sheetData.length ? 'completo' : 'parcial'
            };
          });
          break;
        case 'dashboard.getAnalyses':
          data = allKpis.map(k => {
            const prev = allKpis.find(p => p.kpi === k.kpi && p.departamento === k.departamento && p.mes !== k.mes);
            const currNum = parseFloat(String(k.valor).replace(/[R$%\s|]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
            const prevNum = prev ? parseFloat(String(prev.valor).replace(/[R$%\s|]/g, '').replace(/\./g, '').replace(',', '.')) || 0 : 0;
            const variacao = prevNum > 0 ? ((currNum - prevNum) / prevNum) * 100 : null;
            return {
              mes: k.mes,
              departamento: k.departamento,
              kpi: k.kpi,
              valor: k.valor,
              valorNumerico: currNum,
              variacao,
              tendencia: variacao === null ? 'estavel' : variacao > 0 ? 'melhora' : variacao < 0 ? 'piora' : 'estavel',
              status: 'normal'
            };
          });
          break;
        case 'dashboard.getUnreadAlerts':
          data = [];
          break;
        case 'dashboard.getLastSync':
          data = { lastSync: new Date().toISOString(), hasData: true };
          break;
        case 'dashboard.sync':
          data = { success: true, syncedAt: new Date().toISOString(), totalKpis: allKpis.length };
          break;
        default:
          data = null;
      }
      results.push({ result: { data: { json: data } } });
    } catch(err) {
      results.push({ error: { json: { message: err.message, code: 'INTERNAL_SERVER_ERROR' } } });
    }
  }
  return results;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const procedurePath = url.pathname.replace('/api/trpc/', '');
    const queryString = url.search.replace('?', '');
    
    // Para sync, sempre usar fallback (atualizar do Google Sheets)
    if (procedurePath.includes('dashboard.sync')) {
      const result = await handleFallback(procedurePath, queryString);
      return res.status(200).json(result);
    }
    
    // Para outros endpoints, tentar proxy primeiro
    const data = await proxyOrFallback(procedurePath, queryString, req.method, req.body);
    return res.status(200).json(data);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json([{ error: { json: { message: error.message, code: 'INTERNAL_SERVER_ERROR' } } }]);
  }
}
