// API Serverless - Dashboard Visão 360° 
// Sincronização direta com Google Sheets (fonte primária de dados)
// Compatível com o frontend tRPC

const SPREADSHEET_ID = '1yF2DnBX5LQLwbf75afFN8mw-RAwN2k7W-Fp8vQCngUs';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=1091180879`;

// Normalização de nomes de departamento da planilha para o formato do frontend
function normalizeDepartamento(dept) {
  if (!dept) return '';
  let normalized = dept.trim();
  normalized = normalized.replace(/\s*-\s*/g, ' - ');
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized;
}

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
    departamento: normalizeDepartamento(row[0]),
    kpi: row[1] || '',
    descricao: row[2] || '',
    resultadoMes: row[3] || '',
    resultadoMesAnterior: row[4] || '',
    comentario: row[5] || ''
  }));
}

// Todos os meses do ciclo - o frontend busca cards nos meses Ago-Dez
const MESES = ['Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro', 'Janeiro', 'Fevereiro'];

// Meses que o frontend usa para buscar dados dos cards de resumo (hardcoded no frontend)
const FRONTEND_CARD_MONTHS = ['Dezembro', 'Novembro', 'Outubro', 'Setembro', 'Agosto'];

function getCurrentMonth() {
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return months[new Date().getMonth()];
}

function getPreviousMonth(currentMonth) {
  const idx = MESES.indexOf(currentMonth);
  return idx > 0 ? MESES[idx - 1] : null;
}

function generateKpisFromSheet(sheetData) {
  const currentMonth = getCurrentMonth();
  const previousMonth = getPreviousMonth(currentMonth);
  const kpis = [];
  let id = 70001;
  const seen = new Set();
  
  for (const row of sheetData) {
    // Dados do mês atual (resultado do mês)
    if (row.resultadoMes) {
      const keyAtual = `${currentMonth}|${row.departamento}|${row.kpi}`;
      if (!seen.has(keyAtual)) {
        seen.add(keyAtual);
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
      }
    }
    
    // Dados do mês anterior
    if (previousMonth && row.resultadoMesAnterior) {
      const keyAnterior = `${previousMonth}|${row.departamento}|${row.kpi}`;
      if (!seen.has(keyAnterior)) {
        seen.add(keyAnterior);
        kpis.push({
          id: id++,
          mes: previousMonth,
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
    
    // COMPATIBILIDADE: O frontend busca cards de resumo nos meses Ago-Dez (hardcoded).
    // Para que os cards funcionem, duplicamos os dados do mês atual no mês "Dezembro"
    // e os dados do mês anterior no mês "Novembro" (se não estiverem nesses meses).
    if (currentMonth !== 'Dezembro' && row.resultadoMes) {
      const keyCompat = `Dezembro|${row.departamento}|${row.kpi}`;
      if (!seen.has(keyCompat)) {
        seen.add(keyCompat);
        kpis.push({
          id: id++,
          mes: 'Dezembro',
          departamento: row.departamento,
          kpi: row.kpi,
          descricao: row.descricao,
          valor: row.resultadoMes,
          comentario: row.comentario || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    }
    if (previousMonth !== 'Novembro' && row.resultadoMesAnterior) {
      const keyCompat2 = `Novembro|${row.departamento}|${row.kpi}`;
      if (!seen.has(keyCompat2)) {
        seen.add(keyCompat2);
        kpis.push({
          id: id++,
          mes: 'Novembro',
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
  }
  return kpis;
}

// Filtro de departamento preciso - evita falsos positivos com includes()
function matchDepartamento(kpiDept, requestedDept) {
  const normK = normalizeDepartamento(kpiDept);
  const normR = normalizeDepartamento(requestedDept);
  
  // Match exato (caso ideal)
  if (normK === normR) return true;
  
  // Match parcial seguro: só se o departamento solicitado é mais específico
  // Ex: "Administrativo e Comercial - Estratégico" contém "Estratégico"
  // Mas "Comercial" NÃO deve matchear com "Administrativo e Comercial - Estratégico"
  
  // Se o solicitado é curto (ex: "Comercial"), só aceitar match exato
  if (normR.length <= 15) return normK === normR;
  
  // Se o solicitado é longo, verificar se contém o departamento do KPI
  return normK === normR;
}

// Buscar dados diretamente do Google Sheets (fonte primária)
async function handleRequest(procedurePath, queryString) {
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
  const previousMonth = getPreviousMonth(currentMonth);
  const uniqueKpiCount = sheetData.length;
  
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
          data = allKpis.filter(k => matchDepartamento(k.departamento, dept));
          break;
        }
        
        case 'dashboard.getMonthStats': {
          const monthsWithData = new Set(allKpis.map(k => k.mes));
          
          data = MESES.filter(m => MESES.indexOf(m) <= MESES.indexOf(currentMonth)).map(mes => {
            // Para meses de compatibilidade (Dez/Nov), não contar como dados reais
            const isCompatMonth = (mes === 'Dezembro' && currentMonth !== 'Dezembro') || 
                                  (mes === 'Novembro' && previousMonth !== 'Novembro');
            const isRealMonth = mes === currentMonth || mes === previousMonth;
            
            const monthKpis = allKpis.filter(k => k.mes === mes);
            const hasData = isRealMonth;
            
            return {
              mes,
              totalKpis: uniqueKpiCount,
              kpisPreenchidos: isRealMonth ? Math.min(monthKpis.length, uniqueKpiCount) : 0,
              percentualPreenchimento: isRealMonth ? Math.min(Math.round((Math.min(monthKpis.length, uniqueKpiCount) / uniqueKpiCount) * 100), 100) : 0,
              status: !isRealMonth ? 'sem_dados' : monthKpis.length >= uniqueKpiCount ? 'completo' : 'parcial'
            };
          });
          break;
        }
        
        case 'dashboard.getAnalyses': {
          // Gerar análises para TODOS os meses que têm dados (incluindo meses de compatibilidade)
          // O frontend busca análises nos meses Dez/Nov para os cards de resumo
          const analysisMonths = new Set(allKpis.map(k => k.mes));
          
          data = allKpis.map(k => {
            // Encontrar o valor de comparação: para meses reais, comparar com mês anterior
            // Para meses de compatibilidade, usar a mesma lógica
            let prev = null;
            if (k.mes === currentMonth || k.mes === 'Dezembro') {
              prev = allKpis.find(p => p.kpi === k.kpi && p.departamento === k.departamento && 
                (p.mes === previousMonth || p.mes === 'Novembro') && p.mes !== k.mes);
            } else if (k.mes === previousMonth || k.mes === 'Novembro') {
              // Mês anterior não tem comparação
              prev = null;
            }
            
            const currNum = parseFloat(String(k.valor).replace(/[R$%\s|]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
            const prevNum = prev ? parseFloat(String(prev.valor).replace(/[R$%\s|]/g, '').replace(/\./g, '').replace(',', '.')) || 0 : 0;
            const variacao = prevNum > 0 ? ((currNum - prevNum) / prevNum) * 100 : null;
            return {
              mes: k.mes,
              departamento: k.departamento,
              kpi: k.kpi,
              valor: k.valor,
              valorNumerico: currNum,
              variacao: variacao !== null ? Math.round(variacao * 10) / 10 : null,
              tendencia: variacao === null ? 'estavel' : variacao > 0 ? 'melhora' : variacao < 0 ? 'piora' : 'estavel',
              status: 'normal'
            };
          });
          break;
        }
          
        case 'dashboard.getUnreadAlerts': {
          const alerts = [];
          let alertId = 1;
          allKpis.filter(k => k.mes === currentMonth).forEach(k => {
            const prev = allKpis.find(p => p.kpi === k.kpi && p.departamento === k.departamento && p.mes === previousMonth);
            if (prev) {
              const currNum = parseFloat(String(k.valor).replace(/[R$%\s|]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
              const prevNum = parseFloat(String(prev.valor).replace(/[R$%\s|]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
              if (prevNum > 0) {
                const variacao = ((currNum - prevNum) / prevNum) * 100;
                if (Math.abs(variacao) > 20) {
                  alerts.push({
                    id: alertId++,
                    tipo: variacao > 0 ? 'melhora_significativa' : 'piora_significativa',
                    departamento: k.departamento,
                    kpi: k.kpi,
                    mensagem: `${k.kpi} (${k.departamento}): variação de ${variacao > 0 ? '+' : ''}${Math.round(variacao)}% em relação ao mês anterior`,
                    lido: false,
                    createdAt: new Date().toISOString()
                  });
                }
              }
            }
          });
          data = alerts;
          break;
        }
        
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
    
    const data = await handleRequest(procedurePath, queryString);
    return res.status(200).json(data);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json([{ error: { json: { message: error.message, code: 'INTERNAL_SERVER_ERROR' } } }]);
  }
}
