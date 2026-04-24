// api/download-ea.js
// Genera el archivo .mq5 o .mq4 con el token del usuario ya incluido
const SURL = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Token del usuario via query param o header
  const userToken = req.query.token || req.headers['x-auth-token'];
  const platform  = req.query.platform || 'mt5'; // mt5 o mt4

  if (!userToken) return res.status(401).json({ error: 'Token requerido' });

  // Verificar que el token existe
  const r1 = await fetch(
    `${SURL}/rest/v1/api_keys?token=eq.${encodeURIComponent(userToken)}&activo=eq.true&select=user_id`,
    { headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` } }
  );
  const keys = await r1.json();
  if (!keys || !keys.length) return res.status(401).json({ error: 'Token invalido' });

  const endpoint = 'https://tradyncapp.com/api';
  const ext      = platform === 'mt4' ? 'mq4' : 'mq5';
  const filename = `TradyncSync_${platform.toUpperCase()}.${ext}`;

  // Generar contenido del EA con token ya incluido
  const eaContent = platform === 'mt4'
    ? generateMT4(userToken, endpoint)
    : generateMT5(userToken, endpoint);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(eaContent);
};

// ── GENERAR EA MT5 ────────────────────────────────────────────
function generateMT5(token, endpoint) {
  return `//+------------------------------------------------------------------+
//|                                           TradyncSync_MT5.mq5   |
//|                              Tu journal de trading automatico    |
//|                                      https://tradyncapp.com      |
//+------------------------------------------------------------------+
#property copyright "TradyncApp.com"
#property link      "https://tradyncapp.com"
#property version   "2.00"
#property description "Sincroniza tus operaciones con TradyncApp automaticamente"
#property strict

//--- Configuracion (ya pre-configurada para tu cuenta)
input int    SyncInterval = 3;      // Intervalo de sincronizacion (segundos)
input bool   EnableLogs   = true;   // Activar logs en el diario

//--- Variables internas (pre-configuradas)
string TOKEN        = "${token}";
string ENDPOINT     = "${endpoint}";

//--- Cache
struct PosCache { ulong ticket; double sl; double tp; double vol; };
PosCache posCache[];
ulong    sentTickets[];

int OnInit() {
   if(StringLen(TOKEN) < 10) {
      Alert("Error: Token no valido. Descarga el EA de nuevo desde TradyncApp.");
      return INIT_FAILED;
   }
   Log("TradyncSync iniciado. Cuenta: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
   RegisterAccount();
   SyncPositions(true);
   EventSetTimer(SyncInterval);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   EventKillTimer();
}

void OnTimer() {
   SyncPositions(false);
   CheckClosedTrades();
}

void OnTrade() {
   Sleep(300);
   SyncPositions(false);
   CheckClosedTrades();
}

void RegisterAccount() {
   string tipo = "real";
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO) tipo="demo";
   string json = "{\\"account_number\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
      + ",\\"broker\\":\\"" + EscJ(AccountInfoString(ACCOUNT_COMPANY)) + "\\""
      + ",\\"server\\":\\"" + EscJ(AccountInfoString(ACCOUNT_SERVER)) + "\\""
      + ",\\"currency\\":\\"" + EscJ(AccountInfoString(ACCOUNT_CURRENCY)) + "\\""
      + ",\\"leverage\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE))
      + ",\\"balance\\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),2)
      + ",\\"platform\\":\\"MT5\\",\\"account_type\\":\\"" + tipo + "\\"}";
   string resp = Post(ENDPOINT + "/mt-register", json);
   Log("Cuenta registrada: " + resp);
}

void SyncPositions(bool force) {
   int total = PositionsTotal();
   PosCache current[];
   ArrayResize(current, total);
   for(int i=0; i<total; i++) {
      ulong tk = PositionGetTicket(i);
      if(!tk || !PositionSelectByTicket(tk)) continue;
      current[i].ticket = tk;
      current[i].sl  = PositionGetDouble(POSITION_SL);
      current[i].tp  = PositionGetDouble(POSITION_TP);
      current[i].vol = PositionGetDouble(POSITION_VOLUME);
      if(force || Changed(tk, current[i])) SendPos(tk);
   }
   ArrayCopy(posCache, current);
}

void SendPos(ulong tk) {
   if(!PositionSelectByTicket(tk)) return;
   string tipo = PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?"BUY":"SELL";
   string json = "{\\"ticket\\":" + IntegerToString(tk)
      + ",\\"symbol\\":\\"" + EscJ(PositionGetString(POSITION_SYMBOL)) + "\\""
      + ",\\"type\\":\\"" + tipo + "\\""
      + ",\\"volume\\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME),2)
      + ",\\"open_price\\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN),5)
      + ",\\"sl\\":" + DoubleToString(PositionGetDouble(POSITION_SL),5)
      + ",\\"tp\\":" + DoubleToString(PositionGetDouble(POSITION_TP),5)
      + ",\\"open_time\\":\\"" + FmtDT((datetime)PositionGetInteger(POSITION_TIME)) + "\\""
      + ",\\"profit\\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT),2)
      + ",\\"swap\\":" + DoubleToString(PositionGetDouble(POSITION_SWAP),2)
      + ",\\"comment\\":\\"" + EscJ(PositionGetString(POSITION_COMMENT)) + "\\""
      + ",\\"magic\\":" + IntegerToString(PositionGetInteger(POSITION_MAGIC))
      + ",\\"account\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "}";
   string resp = Post(ENDPOINT + "/mt-sync", json);
   if(StringFind(resp,"close_all")>=0) CloseAll();
   Log("Sincronizado ticket " + IntegerToString(tk));
}

void CheckClosedTrades() {
   HistorySelect(TimeCurrent()-86400, TimeCurrent());
   int total = HistoryDealsTotal();
   for(int i=total-1; i>=0; i--) {
      ulong dk = HistoryDealGetTicket(i);
      if(!dk) continue;
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(dk,DEAL_ENTRY)!=DEAL_ENTRY_OUT) continue;
      if(Sent(dk)) continue;
      SendClosed(dk);
      MarkSent(dk);
   }
}

void SendClosed(ulong dk) {
   ulong posId = HistoryDealGetInteger(dk, DEAL_POSITION_ID);
   double openPx=0; datetime openT=0; string tipo="BUY";
   HistorySelectByPosition(posId);
   for(int j=0;j<HistoryDealsTotal();j++) {
      ulong d=HistoryDealGetTicket(j);
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(d,DEAL_ENTRY)==DEAL_ENTRY_IN) {
         openPx=HistoryDealGetDouble(d,DEAL_PRICE);
         openT=(datetime)HistoryDealGetInteger(d,DEAL_TIME);
         tipo=HistoryDealGetInteger(d,DEAL_TYPE)==DEAL_TYPE_BUY?"BUY":"SELL";
         break;
      }
   }
   string json = "{\\"ticket\\":" + IntegerToString(posId)
      + ",\\"symbol\\":\\"" + EscJ(HistoryDealGetString(dk,DEAL_SYMBOL)) + "\\""
      + ",\\"type\\":\\"" + tipo + "\\""
      + ",\\"volume\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_VOLUME),2)
      + ",\\"open_price\\":" + DoubleToString(openPx,5)
      + ",\\"close_price\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_PRICE),5)
      + ",\\"open_time\\":\\"" + FmtDT(openT) + "\\""
      + ",\\"close_time\\":\\"" + FmtDT((datetime)HistoryDealGetInteger(dk,DEAL_TIME)) + "\\""
      + ",\\"profit\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_PROFIT),2)
      + ",\\"swap\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_SWAP),2)
      + ",\\"commission\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_COMMISSION),2)
      + ",\\"comment\\":\\"" + EscJ(HistoryDealGetString(dk,DEAL_COMMENT)) + "\\""
      + ",\\"magic\\":" + IntegerToString(HistoryDealGetInteger(dk,DEAL_MAGIC))
      + ",\\"account\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "}";
   string resp = Post(ENDPOINT + "/mt-trade", json);
   Log("Operacion cerrada enviada. Ticket: " + IntegerToString(posId) + " | Profit: " + DoubleToString(HistoryDealGetDouble(dk,DEAL_PROFIT),2));
}

string Post(string url, string body) {
   string headers = "Content-Type: application/json\\r\\nX-Auth-Token: " + TOKEN + "\\r\\n";
   char post[]; char result[]; string rheaders;
   StringToCharArray(body, post, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 5000, post, result, rheaders);
   if(res==-1) {
      int err=GetLastError();
      Log("ERROR HTTP " + IntegerToString(err) + " URL: " + url);
      if(err==4060) Alert("Activa WebRequests en MT5: Herramientas > Opciones > Expert Advisors > Permitir WebRequest > Añadir: https://tradyncapp.com");
      return "";
   }
   return CharArrayToString(result);
}

void CloseAll() {
   for(int i=PositionsTotal()-1;i>=0;i--) {
      ulong tk=PositionGetTicket(i);
      if(!tk) continue;
      MqlTradeRequest rq; MqlTradeResult rs; ZeroMemory(rq); ZeroMemory(rs);
      rq.action=TRADE_ACTION_DEAL; rq.position=tk;
      rq.symbol=PositionGetString(POSITION_SYMBOL);
      rq.volume=PositionGetDouble(POSITION_VOLUME);
      rq.type=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?ORDER_TYPE_SELL:ORDER_TYPE_BUY;
      rq.price=rq.type==ORDER_TYPE_SELL?SymbolInfoDouble(rq.symbol,SYMBOL_BID):SymbolInfoDouble(rq.symbol,SYMBOL_ASK);
      rq.deviation=20; rq.comment="TradyncApp: cierre por alerta";
      OrderSend(rq,rs);
   }
}

bool Changed(ulong tk, PosCache &p) {
   for(int i=0;i<ArraySize(posCache);i++) {
      if(posCache[i].ticket==tk)
         return MathAbs(posCache[i].sl-p.sl)>0.00001||MathAbs(posCache[i].tp-p.tp)>0.00001||MathAbs(posCache[i].vol-p.vol)>0.00001;
   }
   return true;
}

bool Sent(ulong tk) {
   for(int i=0;i<ArraySize(sentTickets);i++) if(sentTickets[i]==tk) return true;
   return false;
}

void MarkSent(ulong tk) {
   int s=ArraySize(sentTickets); ArrayResize(sentTickets,s+1); sentTickets[s]=tk;
}

string FmtDT(datetime dt) {
   MqlDateTime m; TimeToStruct(dt,m);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",m.year,m.mon,m.day,m.hour,m.min,m.sec);
}

string EscJ(string s) {
   StringReplace(s,"\\\\","\\\\\\\\"); StringReplace(s,"\\"","\\\\\"");
   StringReplace(s,"\\n","\\\\n"); return s;
}

void Log(string msg) { if(EnableLogs) Print("TradyncSync: "+msg); }
//+------------------------------------------------------------------+`;
}

// ── GENERAR EA MT4 ────────────────────────────────────────────
function generateMT4(token, endpoint) {
  return `//+------------------------------------------------------------------+
//|                                           TradyncSync_MT4.mq4   |
//|                              Tu journal de trading automatico    |
//|                                      https://tradyncapp.com      |
//+------------------------------------------------------------------+
#property copyright "TradyncApp.com"
#property link      "https://tradyncapp.com"
#property version   "2.00"
#property strict

extern int  SyncInterval = 3;     // Intervalo de sincronizacion (segundos)
extern bool EnableLogs   = true;  // Activar logs

string TOKEN    = "${token}";
string ENDPOINT = "${endpoint}";

int    lastTotal = 0;
string sentIds   = "";

struct OrdCache { int ticket; double sl; double tp; };
OrdCache cache[];

int OnInit() {
   if(StringLen(TOKEN)<10) { Alert("Token no valido. Descarga el EA de nuevo desde TradyncApp."); return INIT_FAILED; }
   Log("TradyncSync MT4 iniciado. Cuenta: " + IntegerToString(AccountNumber()));
   RegisterAccount();
   SyncOrders(true);
   EventSetTimer(SyncInterval);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer() { SyncOrders(false); CheckClosed(); }

void OnTick() {
   int cur=OrdersTotal();
   if(cur!=lastTotal) { lastTotal=cur; SyncOrders(false); CheckClosed(); }
}

void RegisterAccount() {
   string tipo = IsDemo()?"demo":"real";
   string json = "{\\"account_number\\":" + IntegerToString(AccountNumber())
      + ",\\"broker\\":\\"" + EscJ(AccountCompany()) + "\\""
      + ",\\"server\\":\\"" + EscJ(AccountServer()) + "\\""
      + ",\\"currency\\":\\"" + EscJ(AccountCurrency()) + "\\""
      + ",\\"leverage\\":" + IntegerToString(AccountLeverage())
      + ",\\"balance\\":" + DoubleToString(AccountBalance(),2)
      + ",\\"platform\\":\\"MT4\\",\\"account_type\\":\\"" + tipo + "\\"}";
   Log("Cuenta registrada: " + Post(ENDPOINT+"/mt-register", json));
}

void SyncOrders(bool force) {
   int total=OrdersTotal();
   OrdCache cur[]; ArrayResize(cur,total);
   for(int i=0;i<total;i++) {
      if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES)) continue;
      if(OrderType()!=OP_BUY && OrderType()!=OP_SELL) continue;
      cur[i].ticket=OrderTicket(); cur[i].sl=OrderStopLoss(); cur[i].tp=OrderTakeProfit();
      if(force||Changed(OrderTicket(),cur[i])) SendOrder(OrderTicket());
   }
   ArrayCopy(cache,cur);
}

void SendOrder(int tk) {
   if(!OrderSelect(tk,SELECT_BY_TICKET,MODE_TRADES)) return;
   string tipo=OrderType()==OP_BUY?"BUY":"SELL";
   string json = "{\\"ticket\\":" + IntegerToString(tk)
      + ",\\"symbol\\":\\"" + EscJ(OrderSymbol()) + "\\""
      + ",\\"type\\":\\"" + tipo + "\\""
      + ",\\"volume\\":" + DoubleToString(OrderLots(),2)
      + ",\\"open_price\\":" + DoubleToString(OrderOpenPrice(),5)
      + ",\\"sl\\":" + DoubleToString(OrderStopLoss(),5)
      + ",\\"tp\\":" + DoubleToString(OrderTakeProfit(),5)
      + ",\\"open_time\\":\\"" + FmtDT(OrderOpenTime()) + "\\""
      + ",\\"profit\\":" + DoubleToString(OrderProfit(),2)
      + ",\\"swap\\":" + DoubleToString(OrderSwap(),2)
      + ",\\"comment\\":\\"" + EscJ(OrderComment()) + "\\""
      + ",\\"magic\\":" + IntegerToString(OrderMagicNumber())
      + ",\\"account\\":" + IntegerToString(AccountNumber()) + "}";
   string resp=Post(ENDPOINT+"/mt-sync",json);
   if(StringFind(resp,"close_all")>=0) CloseAll();
}

void CheckClosed() {
   datetime desde=TimeCurrent()-86400;
   for(int i=OrdersHistoryTotal()-1;i>=0;i--) {
      if(!OrderSelect(i,SELECT_BY_POS,MODE_HISTORY)) continue;
      if(OrderType()!=OP_BUY && OrderType()!=OP_SELL) continue;
      if(OrderCloseTime()<desde) continue;
      if(Sent(OrderTicket())) continue;
      SendClosed(OrderTicket());
      MarkSent(OrderTicket());
   }
}

void SendClosed(int tk) {
   if(!OrderSelect(tk,SELECT_BY_TICKET,MODE_HISTORY)) return;
   string tipo=OrderType()==OP_BUY?"BUY":"SELL";
   string json = "{\\"ticket\\":" + IntegerToString(tk)
      + ",\\"symbol\\":\\"" + EscJ(OrderSymbol()) + "\\""
      + ",\\"type\\":\\"" + tipo + "\\""
      + ",\\"volume\\":" + DoubleToString(OrderLots(),2)
      + ",\\"open_price\\":" + DoubleToString(OrderOpenPrice(),5)
      + ",\\"close_price\\":" + DoubleToString(OrderClosePrice(),5)
      + ",\\"open_time\\":\\"" + FmtDT(OrderOpenTime()) + "\\""
      + ",\\"close_time\\":\\"" + FmtDT(OrderCloseTime()) + "\\""
      + ",\\"profit\\":" + DoubleToString(OrderProfit(),2)
      + ",\\"swap\\":" + DoubleToString(OrderSwap(),2)
      + ",\\"commission\\":" + DoubleToString(OrderCommission(),2)
      + ",\\"comment\\":\\"" + EscJ(OrderComment()) + "\\""
      + ",\\"magic\\":" + IntegerToString(OrderMagicNumber())
      + ",\\"account\\":" + IntegerToString(AccountNumber()) + "}";
   Log("Operacion cerrada enviada. Ticket: " + IntegerToString(tk) + " | Profit: " + DoubleToString(OrderProfit(),2));
   Post(ENDPOINT+"/mt-trade", json);
}

string Post(string url, string body) {
   string headers="Content-Type: application/json\\r\\nX-Auth-Token: "+TOKEN+"\\r\\n";
   char post[]; char result[]; string rh;
   StringToCharArray(body,post,0,StringLen(body));
   int res=WebRequest("POST",url,headers,5000,post,result,rh);
   if(res==-1) {
      int err=GetLastError();
      Log("ERROR HTTP "+IntegerToString(err)+" URL: "+url);
      if(err==4060) Alert("Activa WebRequests en MT4: Herramientas > Opciones > Expert Advisors > Permitir WebRequest > Añadir: https://tradyncapp.com");
      return "";
   }
   return CharArrayToString(result);
}

void CloseAll() {
   for(int i=OrdersTotal()-1;i>=0;i--) {
      if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES)) continue;
      if(OrderType()!=OP_BUY && OrderType()!=OP_SELL) continue;
      double px=OrderType()==OP_BUY?MarketInfo(OrderSymbol(),MODE_BID):MarketInfo(OrderSymbol(),MODE_ASK);
      OrderClose(OrderTicket(),OrderLots(),px,20,clrRed);
   }
}

bool Changed(int tk, OrdCache &o) {
   for(int i=0;i<ArraySize(cache);i++)
      if(cache[i].ticket==tk) return MathAbs(cache[i].sl-o.sl)>0.00001||MathAbs(cache[i].tp-o.tp)>0.00001;
   return true;
}

bool Sent(int tk) { return StringFind(sentIds,","+IntegerToString(tk)+",")>=0; }
void MarkSent(int tk) { sentIds+=","+IntegerToString(tk)+","; if(StringLen(sentIds)>10000) sentIds=""; }

string FmtDT(datetime dt) { return TimeToString(dt,TIME_DATE)+"T"+TimeToString(dt,TIME_MINUTES)+":00Z"; }
string EscJ(string s) { StringReplace(s,"\\\\","\\\\\\\\"); StringReplace(s,"\\"","\\\\\""); return s; }
void Log(string msg) { if(EnableLogs) Print("TradyncSync: "+msg); }
//+------------------------------------------------------------------+`;
}
