// api/download-ea.js
// Genera el EA con el token del usuario ya incluido
const SURL = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;

const MT5_TEMPLATE = `//+------------------------------------------------------------------+
//|                                           TradyncSync_MT5.mq5    |
//|                              Tu journal de trading automatico     |
//|                                      https://tradyncapp.com       |
//+------------------------------------------------------------------+
#property copyright "TradyncApp.com"
#property link      "https://tradyncapp.com"
#property version   "2.00"
#property description "Sincroniza tus operaciones con TradyncApp automaticamente"
#property strict

//--- Configuracion del usuario
input int    SyncInterval = 3;     // Intervalo sincronizacion (segundos)
input bool   EnableLogs   = true;  // Activar logs en el diario

//--- Variables internas
string TOKEN    = "PEGA_TU_TOKEN_AQUI";
string ENDPOINT = "https://tradyncapp.com/api";

//--- Cache
struct PosCache { ulong ticket; double sl; double tp; double vol; };
PosCache posCache[];
ulong    sentTickets[];

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(TOKEN) < 10) {
      Alert("Token no valido. Descarga el EA desde TradyncApp > Conectar Broker.");
      return INIT_FAILED;
   }
   Log("TradyncSync iniciado. Cuenta: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
   RegisterAccount();
   SyncPositions(true);
   EventSetTimer(SyncInterval);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer()  { SyncPositions(false); CheckClosedTrades(); }
void OnTrade()  { Sleep(300); SyncPositions(false); CheckClosedTrades(); }

//+------------------------------------------------------------------+
void RegisterAccount()
{
   string tipo = "real";
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO)
      tipo = "demo";

   string json = "{";
   json += "\\"account_number\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   json += "\\"broker\\":\\"" + EscJ(AccountInfoString(ACCOUNT_COMPANY)) + "\\",";
   json += "\\"server\\":\\"" + EscJ(AccountInfoString(ACCOUNT_SERVER)) + "\\",";
   json += "\\"currency\\":\\"" + EscJ(AccountInfoString(ACCOUNT_CURRENCY)) + "\\",";
   json += "\\"leverage\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",";
   json += "\\"balance\\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   json += "\\"platform\\":\\"MT5\\",";
   json += "\\"account_type\\":\\"" + tipo + "\\"";
   json += "}";

   string resp = Post(ENDPOINT + "/mt-register", json);
   Log("Cuenta registrada: " + resp);
}

//+------------------------------------------------------------------+
void SyncPositions(bool force)
{
   int total = PositionsTotal();
   PosCache current[];
   ArrayResize(current, total);

   for(int i = 0; i < total; i++) {
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

//+------------------------------------------------------------------+
void SendPos(ulong tk)
{
   if(!PositionSelectByTicket(tk)) return;
   string tipo = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL";

   string json = "{";
   json += "\\"ticket\\":" + IntegerToString(tk) + ",";
   json += "\\"symbol\\":\\"" + EscJ(PositionGetString(POSITION_SYMBOL)) + "\\",";
   json += "\\"type\\":\\"" + tipo + "\\",";
   json += "\\"volume\\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) + ",";
   json += "\\"open_price\\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 5) + ",";
   json += "\\"sl\\":" + DoubleToString(PositionGetDouble(POSITION_SL), 5) + ",";
   json += "\\"tp\\":" + DoubleToString(PositionGetDouble(POSITION_TP), 5) + ",";
   json += "\\"open_time\\":\\"" + FmtDT((datetime)PositionGetInteger(POSITION_TIME)) + "\\",";
   json += "\\"profit\\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + ",";
   json += "\\"swap\\":" + DoubleToString(PositionGetDouble(POSITION_SWAP), 2) + ",";
   json += "\\"comment\\":\\"" + EscJ(PositionGetString(POSITION_COMMENT)) + "\\",";
   json += "\\"magic\\":" + IntegerToString(PositionGetInteger(POSITION_MAGIC)) + ",";
   json += "\\"account\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   json += "}";

   string resp = Post(ENDPOINT + "/mt-sync", json);
   if(StringFind(resp, "close_all") >= 0) CloseAll();
   Log("Sincronizado ticket " + IntegerToString(tk));
}

//+------------------------------------------------------------------+
void CheckClosedTrades()
{
   HistorySelect(TimeCurrent() - 86400, TimeCurrent());
   int total = HistoryDealsTotal();

   for(int i = total - 1; i >= 0; i--) {
      ulong dk = HistoryDealGetTicket(i);
      if(!dk) continue;
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(dk, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      if(Sent(dk)) continue;
      SendClosed(dk);
      MarkSent(dk);
   }
}

//+------------------------------------------------------------------+
void SendClosed(ulong dk)
{
   ulong posId   = HistoryDealGetInteger(dk, DEAL_POSITION_ID);
   double openPx = 0;
   datetime openT = 0;
   string tipo = "BUY";

   HistorySelectByPosition(posId);
   for(int j = 0; j < HistoryDealsTotal(); j++) {
      ulong d = HistoryDealGetTicket(j);
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN) {
         openPx = HistoryDealGetDouble(d, DEAL_PRICE);
         openT  = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
         tipo   = HistoryDealGetInteger(d, DEAL_TYPE) == DEAL_TYPE_BUY ? "BUY" : "SELL";
         break;
      }
   }

   string json = "{";
   json += "\\"ticket\\":" + IntegerToString(posId) + ",";
   json += "\\"symbol\\":\\"" + EscJ(HistoryDealGetString(dk, DEAL_SYMBOL)) + "\\",";
   json += "\\"type\\":\\"" + tipo + "\\",";
   json += "\\"volume\\":" + DoubleToString(HistoryDealGetDouble(dk, DEAL_VOLUME), 2) + ",";
   json += "\\"open_price\\":" + DoubleToString(openPx, 5) + ",";
   json += "\\"close_price\\":" + DoubleToString(HistoryDealGetDouble(dk, DEAL_PRICE), 5) + ",";
   json += "\\"open_time\\":\\"" + FmtDT(openT) + "\\",";
   json += "\\"close_time\\":\\"" + FmtDT((datetime)HistoryDealGetInteger(dk, DEAL_TIME)) + "\\",";
   json += "\\"profit\\":" + DoubleToString(HistoryDealGetDouble(dk, DEAL_PROFIT), 2) + ",";
   json += "\\"swap\\":" + DoubleToString(HistoryDealGetDouble(dk, DEAL_SWAP), 2) + ",";
   json += "\\"commission\\":" + DoubleToString(HistoryDealGetDouble(dk, DEAL_COMMISSION), 2) + ",";
   json += "\\"comment\\":\\"" + EscJ(HistoryDealGetString(dk, DEAL_COMMENT)) + "\\",";
   json += "\\"magic\\":" + IntegerToString(HistoryDealGetInteger(dk, DEAL_MAGIC)) + ",";
   json += "\\"account\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   json += "}";

   Post(ENDPOINT + "/mt-trade", json);
   Log("Operacion cerrada. Ticket: " + IntegerToString(posId) +
       " | Profit: " + DoubleToString(HistoryDealGetDouble(dk, DEAL_PROFIT), 2));
}

//+------------------------------------------------------------------+
string Post(string url, string body)
{
   string headers = "Content-Type: application/json\\r\\nX-Auth-Token: " + TOKEN + "\\r\\n";
   char   post[];
   char   result[];
   string rh;

   StringToCharArray(body, post, 0, StringLen(body));
   int res = WebRequest("POST", url, headers, 5000, post, result, rh);

   if(res == -1) {
      int err = GetLastError();
      Log("ERROR HTTP " + IntegerToString(err) + " | " + url);
      if(err == 4060)
         Alert("Activa WebRequests en MT5:\\nHerramientas > Opciones > Expert Advisors\\n> Permitir WebRequest > Añadir: https://tradyncapp.com");
      return "";
   }
   return CharArrayToString(result);
}

//+------------------------------------------------------------------+
void CloseAll()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong tk = PositionGetTicket(i);
      if(!tk) continue;
      MqlTradeRequest rq;
      MqlTradeResult  rs;
      ZeroMemory(rq); ZeroMemory(rs);
      rq.action   = TRADE_ACTION_DEAL;
      rq.position = tk;
      rq.symbol   = PositionGetString(POSITION_SYMBOL);
      rq.volume   = PositionGetDouble(POSITION_VOLUME);
      rq.type     = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
      rq.price    = rq.type == ORDER_TYPE_SELL ?
                    SymbolInfoDouble(rq.symbol, SYMBOL_BID) :
                    SymbolInfoDouble(rq.symbol, SYMBOL_ASK);
      rq.deviation = 20;
      rq.comment   = "TradyncApp: cierre por alerta";
      OrderSend(rq, rs);
   }
}

//+------------------------------------------------------------------+
bool Changed(ulong tk, PosCache &p)
{
   for(int i = 0; i < ArraySize(posCache); i++) {
      if(posCache[i].ticket == tk)
         return MathAbs(posCache[i].sl  - p.sl)  > 0.00001 ||
                MathAbs(posCache[i].tp  - p.tp)  > 0.00001 ||
                MathAbs(posCache[i].vol - p.vol) > 0.00001;
   }
   return true;
}

bool Sent(ulong tk)
{
   for(int i = 0; i < ArraySize(sentTickets); i++)
      if(sentTickets[i] == tk) return true;
   return false;
}

void MarkSent(ulong tk)
{
   int s = ArraySize(sentTickets);
   ArrayResize(sentTickets, s + 1);
   sentTickets[s] = tk;
}

string FmtDT(datetime dt)
{
   MqlDateTime m;
   TimeToStruct(dt, m);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       m.year, m.mon, m.day, m.hour, m.min, m.sec);
}

string EscJ(string s)
{
   StringReplace(s, "\\\\", "\\\\\\\\");
   StringReplace(s, "\\"", "\\\\\\"");
   StringReplace(s, "\\n", "\\\\n");
   return s;
}

void Log(string msg) { if(EnableLogs) Print("TradyncSync: " + msg); }
//+------------------------------------------------------------------+
`;

const MT4_TEMPLATE = `//+------------------------------------------------------------------+
//|                                              TradyncSync_MT4.mq4 |
//|                                    Copyright 2026, TradyncApp.com |
//|                                         https://tradyncapp.com   |
//+------------------------------------------------------------------+
#property copyright "TradyncApp.com"
#property link      "https://tradyncapp.com"
#property version   "1.00"
#property description "Sincroniza tus operaciones de MT4 con TradyncApp automaticamente"
#property strict

//+------------------------------------------------------------------+
//| PARAMETROS CONFIGURABLES POR EL USUARIO                         |
//+------------------------------------------------------------------+
extern string  Token         = "PEGA_TU_TOKEN_AQUI";  // Token de TradyncApp
extern string  AliasAccount  = "";                    // Alias de la cuenta (opcional)
extern int     SyncInterval  = 3;                     // Intervalo de sincronizacion (segundos)
extern bool    EnableLogs    = true;                  // Activar logs en el diario de MT4
extern string  EndpointBase  = "https://tradyncapp.com/api"; // URL base

//+------------------------------------------------------------------+
//| VARIABLES GLOBALES                                               |
//+------------------------------------------------------------------+
int    totalOrdersLast  = 0;
string sentClosedOrders = ""; // IDs de ordenes cerradas ya enviadas (separados por coma)

struct OrderCache {
   int    ticket;
   double volume;
   double openPrice;
   double sl;
   double tp;
};

OrderCache cachedOrders[];

//+------------------------------------------------------------------+
//| FUNCION DE INICIALIZACION                                        |
//+------------------------------------------------------------------+
int OnInit()
{
   // Verificar token
   if(Token == "PEGA_TU_TOKEN_AQUI" || StringLen(Token) < 10) {
      Alert("TradyncSync: ERROR - Configura tu Token en los parametros del EA");
      Print("TradyncSync: ERROR - Token no configurado. Ve a TradyncApp.com > Tu cuenta > API Key");
      return INIT_FAILED;
   }

   Log("TradyncSync MT4 iniciado. Cuenta: " + IntegerToString(AccountNumber()));

   // Registrar la cuenta
   RegisterAccount();

   // Sincronizacion inicial
   SyncOpenOrders(true);

   // Iniciar timer
   EventSetTimer(SyncInterval);

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| FUNCION DE DESINICIALIZACION                                     |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Log("TradyncSync MT4 detenido. Razon: " + IntegerToString(reason));
}

//+------------------------------------------------------------------+
//| FUNCION TIMER                                                    |
//+------------------------------------------------------------------+
void OnTimer()
{
   SyncOpenOrders(false);
   CheckClosedOrders();
}

//+------------------------------------------------------------------+
//| TICK - Detectar cambios de forma rapida                         |
//+------------------------------------------------------------------+
void OnTick()
{
   // Solo sincronizar si el numero de ordenes ha cambiado
   int currentTotal = OrdersTotal();
   if(currentTotal != totalOrdersLast) {
      totalOrdersLast = currentTotal;
      SyncOpenOrders(false);
      CheckClosedOrders();
   }
}

//+------------------------------------------------------------------+
//| REGISTRAR CUENTA EN TRADYNCAPP                                   |
//+------------------------------------------------------------------+
void RegisterAccount()
{
   string accountType = (AccountNumber() > 0 && !IsDemo()) ? "real" : "demo";

   string json = "{";
   json += "\\"account_number\\":" + IntegerToString(AccountNumber()) + ",";
   json += "\\"broker\\":\\"" + EscapeJson(AccountCompany()) + "\\",";
   json += "\\"server\\":\\"" + EscapeJson(AccountServer()) + "\\",";
   json += "\\"currency\\":\\"" + EscapeJson(AccountCurrency()) + "\\",";
   json += "\\"leverage\\":" + IntegerToString(AccountLeverage()) + ",";
   json += "\\"balance\\":" + DoubleToString(AccountBalance(), 2) + ",";
   json += "\\"platform\\":\\"MT4\\",";
   json += "\\"account_type\\":\\"" + accountType + "\\",";
   json += "\\"alias\\":\\"" + EscapeJson(AliasAccount) + "\\"";
   json += "}";

   string response = SendRequest(EndpointBase + "/mt-register", json);
   Log("Cuenta registrada. Respuesta: " + response);
}

//+------------------------------------------------------------------+
//| SINCRONIZAR ORDENES ABIERTAS                                     |
//+------------------------------------------------------------------+
void SyncOpenOrders(bool forceAll)
{
   int total = OrdersTotal();
   OrderCache newCache[];
   ArrayResize(newCache, total);

   for(int i = 0; i < total; i++) {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;

      // Solo operaciones de mercado (no ordenes pendientes)
      int orderType = OrderType();
      if(orderType != OP_BUY && orderType != OP_SELL) continue;

      int ticket = OrderTicket();
      newCache[i].ticket    = ticket;
      newCache[i].volume    = OrderLots();
      newCache[i].openPrice = OrderOpenPrice();
      newCache[i].sl        = OrderStopLoss();
      newCache[i].tp        = OrderTakeProfit();

      bool changed = forceAll || HasOrderChanged(ticket, newCache[i]);

      if(changed) {
         SendOpenOrder(ticket);
      }
   }

   // Actualizar cache
   ArrayCopy(cachedOrders, newCache);
}

//+------------------------------------------------------------------+
//| ENVIAR ORDEN ABIERTA                                             |
//+------------------------------------------------------------------+
void SendOpenOrder(int ticket)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES)) return;

   string tipo = (OrderType() == OP_BUY) ? "BUY" : "SELL";
   string openTimeStr = FormatDateTime(OrderOpenTime());

   string json = "{";
   json += "\\"ticket\\":" + IntegerToString(ticket) + ",";
   json += "\\"symbol\\":\\"" + EscapeJson(OrderSymbol()) + "\\",";
   json += "\\"type\\":\\"" + tipo + "\\",";
   json += "\\"volume\\":" + DoubleToString(OrderLots(), 2) + ",";
   json += "\\"open_price\\":" + DoubleToString(OrderOpenPrice(), 5) + ",";
   json += "\\"sl\\":" + DoubleToString(OrderStopLoss(), 5) + ",";
   json += "\\"tp\\":" + DoubleToString(OrderTakeProfit(), 5) + ",";
   json += "\\"open_time\\":\\"" + openTimeStr + "\\",";
   json += "\\"profit\\":" + DoubleToString(OrderProfit(), 2) + ",";
   json += "\\"swap\\":" + DoubleToString(OrderSwap(), 2) + ",";
   json += "\\"commission\\":" + DoubleToString(OrderCommission(), 2) + ",";
   json += "\\"comment\\":\\"" + EscapeJson(OrderComment()) + "\\",";
   json += "\\"magic\\":" + IntegerToString(OrderMagicNumber()) + ",";
   json += "\\"account\\":" + IntegerToString(AccountNumber()) + ",";
   json += "\\"status\\":\\"open\\"";
   json += "}";

   string response = SendRequest(EndpointBase + "/mt-sync", json);
   HandleServerResponse(response);
   Log("Orden sincronizada. Ticket: " + IntegerToString(ticket) + " | " + tipo + " " + OrderSymbol());
}

//+------------------------------------------------------------------+
//| VERIFICAR ORDENES CERRADAS                                       |
//+------------------------------------------------------------------+
void CheckClosedOrders()
{
   // Buscar en historial de las ultimas 24 horas
   datetime desde = TimeCurrent() - 86400;

   int total = OrdersHistoryTotal();
   for(int i = total - 1; i >= 0; i--) {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;

      // Solo operaciones de mercado cerradas
      int orderType = OrderType();
      if(orderType != OP_BUY && orderType != OP_SELL) continue;

      // Solo las recientes
      if(OrderCloseTime() < desde) continue;

      int ticket = OrderTicket();

      // Verificar si ya fue enviada
      if(WasAlreadySent(ticket)) continue;

      SendClosedOrder(ticket);
      MarkAsSent(ticket);
   }
}

//+------------------------------------------------------------------+
//| ENVIAR ORDEN CERRADA                                             |
//+------------------------------------------------------------------+
void SendClosedOrder(int ticket)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_HISTORY)) return;

   string tipo      = (OrderType() == OP_BUY) ? "BUY" : "SELL";
   string openTime  = FormatDateTime(OrderOpenTime());
   string closeTime = FormatDateTime(OrderCloseTime());

   string json = "{";
   json += "\\"ticket\\":" + IntegerToString(ticket) + ",";
   json += "\\"symbol\\":\\"" + EscapeJson(OrderSymbol()) + "\\",";
   json += "\\"type\\":\\"" + tipo + "\\",";
   json += "\\"volume\\":" + DoubleToString(OrderLots(), 2) + ",";
   json += "\\"open_price\\":" + DoubleToString(OrderOpenPrice(), 5) + ",";
   json += "\\"close_price\\":" + DoubleToString(OrderClosePrice(), 5) + ",";
   json += "\\"open_time\\":\\"" + openTime + "\\",";
   json += "\\"close_time\\":\\"" + closeTime + "\\",";
   json += "\\"profit\\":" + DoubleToString(OrderProfit(), 2) + ",";
   json += "\\"swap\\":" + DoubleToString(OrderSwap(), 2) + ",";
   json += "\\"commission\\":" + DoubleToString(OrderCommission(), 2) + ",";
   json += "\\"comment\\":\\"" + EscapeJson(OrderComment()) + "\\",";
   json += "\\"magic\\":" + IntegerToString(OrderMagicNumber()) + ",";
   json += "\\"account\\":" + IntegerToString(AccountNumber()) + ",";
   json += "\\"status\\":\\"closed\\"";
   json += "}";

   string response = SendRequest(EndpointBase + "/mt-trade", json);
   HandleServerResponse(response);
   Log("Orden cerrada enviada. Ticket: " + IntegerToString(ticket) +
       " | Profit: " + DoubleToString(OrderProfit(), 2));
}

//+------------------------------------------------------------------+
//| ENVIAR PETICION HTTP POST                                        |
//+------------------------------------------------------------------+
string SendRequest(string url, string jsonBody)
{
   string headers  = "Content-Type: application/json\\r\\n";
          headers += "X-Auth-Token: " + Token + "\\r\\n";

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(jsonBody, postData, 0, StringLen(jsonBody));

   int res = WebRequest(
      "POST",
      url,
      headers,
      5000,
      postData,
      resultData,
      resultHeaders
   );

   if(res == -1) {
      int err = GetLastError();
      Log("ERROR HTTP: " + IntegerToString(err) + " | URL: " + url);
      if(err == 4060) {
         Alert("TradyncSync: Activa WebRequests en MT4: Herramientas > Opciones > Expert Advisors > Permitir WebRequest > Agregar https://tradyncapp.com");
      }
      return "";
   }

   return CharArrayToString(resultData);
}

//+------------------------------------------------------------------+
//| PROCESAR RESPUESTA DEL SERVIDOR                                  |
//+------------------------------------------------------------------+
void HandleServerResponse(string response)
{
   if(StringLen(response) == 0) return;
   if(StringFind(response, "close_all") >= 0) {
      Log("ACCION: close_all - Cerrando todas las posiciones");
      CloseAllOrders();
   }
}

//+------------------------------------------------------------------+
//| CERRAR TODAS LAS ORDENES                                         |
//+------------------------------------------------------------------+
void CloseAllOrders()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--) {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;

      double price = (OrderType() == OP_BUY) ?
                     MarketInfo(OrderSymbol(), MODE_BID) :
                     MarketInfo(OrderSymbol(), MODE_ASK);

      bool closed = OrderClose(OrderTicket(), OrderLots(), price, 20, clrRed);
      if(closed) Log("Orden cerrada por alerta: " + IntegerToString(OrderTicket()));
      else        Log("Error al cerrar: " + IntegerToString(OrderTicket()));
   }
}

//+------------------------------------------------------------------+
//| UTILIDADES                                                       |
//+------------------------------------------------------------------+

bool HasOrderChanged(int ticket, OrderCache &ord)
{
   int size = ArraySize(cachedOrders);
   for(int i = 0; i < size; i++) {
      if(cachedOrders[i].ticket == ticket) {
         return (MathAbs(cachedOrders[i].sl - ord.sl) > 0.00001 ||
                 MathAbs(cachedOrders[i].tp - ord.tp) > 0.00001 ||
                 MathAbs(cachedOrders[i].volume - ord.volume) > 0.00001);
      }
   }
   return true; // No encontrado = nuevo
}

bool WasAlreadySent(int ticket)
{
   return (StringFind(sentClosedOrders, "," + IntegerToString(ticket) + ",") >= 0);
}

void MarkAsSent(int ticket)
{
   sentClosedOrders += "," + IntegerToString(ticket) + ",";
   // Limpiar si es muy largo (mas de 10000 chars)
   if(StringLen(sentClosedOrders) > 10000) sentClosedOrders = "";
}

string FormatDateTime(datetime dt)
{
   return TimeToString(dt, TIME_DATE) + "T" +
          TimeToString(dt, TIME_MINUTES) + ":00Z";
}

string EscapeJson(string s)
{
   StringReplace(s, "\\\\", "\\\\\\\\");
   StringReplace(s, "\\"", "\\\\\\"");
   StringReplace(s, "\\n", "\\\\n");
   return s;
}

void Log(string msg)
{
   if(EnableLogs) Print("TradyncSync: " + msg);
}
//+------------------------------------------------------------------+
`;

module.exports = async function(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userToken = req.query.token || req.headers['x-auth-token'];
  const platform  = (req.query.platform || 'mt5').toLowerCase();

  if (!userToken) return res.status(401).json({ error: 'Token requerido' });

  // Verificar token
  const r1 = await fetch(
    `${SURL}/rest/v1/api_keys?token=eq.${encodeURIComponent(userToken)}&activo=eq.true&select=user_id`,
    { headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` } }
  );
  const keys = await r1.json();
  if (!keys || !keys.length) return res.status(401).json({ error: 'Token invalido' });

  // Sustituir token y endpoint en el EA
  const endpoint = 'https://tradyncapp.com/api';
  const template = platform === 'mt4' ? MT4_TEMPLATE : MT5_TEMPLATE;
  const eaContent = template
    .replace('PEGA_TU_TOKEN_AQUI', userToken)
    .replace('https://tradyncapp.com/api', endpoint);

  const ext      = platform === 'mt4' ? 'mq4' : 'mq5';
  const filename = `TradyncSync_${platform.toUpperCase()}.${ext}`;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(eaContent);
};
