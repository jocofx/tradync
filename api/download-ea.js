// api/download-ea.js v4.1
const SURL=process.env.SUPABASE_URL;
const SKEY=process.env.SUPABASE_SERVICE_KEY;
const MT5_TEMPLATE=`//+------------------------------------------------------------------+
//|                                           TradyncSync_MT5.mq5    |
//|                    Journal + Gestor de Riesgo                    |
//|                                      https://tradyncapp.com       |
//+------------------------------------------------------------------+
#property copyright "TradyncApp.com"
#property link      "https://tradyncapp.com"
#property version   "4.00"
#property strict

//+------------------------------------------------------------------+
//| PARAMETROS                                                        |
//+------------------------------------------------------------------+
input group "=== SINCRONIZACION ==="
input int    SyncInterval            = 3;    // Intervalo sync (seg)
input bool   EnableLogs              = true; // Activar logs

input group "=== GESTOR DE RIESGO ==="
input bool   EnableRiskManager       = true; // Activar gestor de riesgo
input int    MaxOperacionesDiarias   = 0;    // Max operaciones por dia (0=sin limite)
input double LimiteGananciaDiaria    = 0;    // Limite ganancia $ (0=sin limite)
input double LimitePerdidaDiaria     = 0;    // Limite perdida $ (0=sin limite)
input int    HoraInicio              = 0;    // Hora inicio permitida (0=sin limite)
input int    HoraFin                 = 0;    // Hora fin permitida (0=sin limite)

//+------------------------------------------------------------------+
//| VARIABLES INTERNAS                                                |
//+------------------------------------------------------------------+
string TOKEN    = "PEGA_TU_TOKEN_AQUI";
string ENDPOINT = "https://www.tradyncapp.com/api";

// Cache sync
struct PosCache { ulong ticket; double sl; double tp; double vol; };
PosCache posCache[];
ulong    sentTickets[];

// Contador diario de operaciones
int      contadorDia   = 0;   // Cuantas ops se han abierto hoy
string   fechaActual   = "";  // Fecha actual en formato YYYY.MM.DD
double   balanceInicio = 0;   // Balance al inicio del dia

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(TOKEN) < 10) {
      Alert("Token no valido. Descarga el EA desde TradyncApp > Conectar Broker.");
      return INIT_FAILED;
   }
   Log("TradyncSync v4 iniciado. Cuenta: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));

   // Inicializar contador del dia
   InicializarDia();

   RegisterAccount();
   SyncPositions(true);
   EventSetTimer(SyncInterval);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer()
{
   VerificarCambioDia();
   SyncPositions(false);
   CheckClosedTrades();
   if(EnableRiskManager) GestorRiesgo();
}

void OnTrade()
{
   Sleep(500); // Esperar a que MT5 registre la operacion
   VerificarCambioDia();
   SyncPositions(false);
   CheckClosedTrades();
   if(EnableRiskManager) GestorRiesgo();
}

//+------------------------------------------------------------------+
//| INICIALIZAR DIA                                                   |
//+------------------------------------------------------------------+
void InicializarDia()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   fechaActual   = StringFormat("%04d.%02d.%02d", dt.year, dt.mon, dt.day);
   balanceInicio = AccountInfoDouble(ACCOUNT_BALANCE);

   // Contar operaciones ya abiertas hoy en el historial
   contadorDia = ContarOpsAbiertasHoy();

   Log("Dia iniciado: " + fechaActual +
       " | Ops hoy: " + IntegerToString(contadorDia) +
       " | Balance inicio: " + DoubleToString(balanceInicio, 2));
}

void VerificarCambioDia()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   string hoy = StringFormat("%04d.%02d.%02d", dt.year, dt.mon, dt.day);
   if(hoy != fechaActual) {
      Log("Nuevo dia detectado. Reiniciando contador.");
      InicializarDia();
   }
}

//+------------------------------------------------------------------+
//| CONTAR OPERACIONES ABIERTAS HOY EN EL HISTORIAL                  |
//| Cuenta cuantos DEAL_ENTRY_IN ocurrieron hoy                      |
//+------------------------------------------------------------------+
int ContarOpsAbiertasHoy()
{
   MqlDateTime dtHoy;
   TimeToStruct(TimeCurrent(), dtHoy);

   HistorySelect(TimeCurrent() - 86400, TimeCurrent());
   int count = 0;
   for(int i = 0; i < HistoryDealsTotal(); i++) {
      ulong dk = HistoryDealGetTicket(i);
      if(!dk) continue;
      // Solo contar aperturas
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(dk, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      // Solo de hoy
      datetime dealTime = (datetime)HistoryDealGetInteger(dk, DEAL_TIME);
      MqlDateTime dtDeal; TimeToStruct(dealTime, dtDeal);
      if(dtDeal.year == dtHoy.year && dtDeal.mon == dtHoy.mon && dtDeal.day == dtHoy.day)
         count++;
   }
   return count;
}

//+------------------------------------------------------------------+
//| GESTOR DE RIESGO PRINCIPAL                                        |
//+------------------------------------------------------------------+
void GestorRiesgo()
{
   int total = PositionsTotal();

   // --- LIMITE DE PERDIDA DIARIA ---
   if(LimitePerdidaDiaria > 0) {
      double pnl = AccountInfoDouble(ACCOUNT_EQUITY) - balanceInicio;
      if(pnl <= -MathAbs(LimitePerdidaDiaria)) {
         Log("RIESGO: Limite perdida diaria alcanzado (" + DoubleToString(pnl,2) + "$). Cerrando todo.");
         CerrarTodas("Limite perdida diaria");
         return;
      }
   }

   // --- LIMITE DE GANANCIA DIARIA ---
   if(LimiteGananciaDiaria > 0) {
      double pnl = AccountInfoDouble(ACCOUNT_EQUITY) - balanceInicio;
      if(pnl >= MathAbs(LimiteGananciaDiaria)) {
         Log("RIESGO: Limite ganancia diaria alcanzado (" + DoubleToString(pnl,2) + "$). Cerrando todo.");
         CerrarTodas("Limite ganancia diaria");
         return;
      }
   }

   // --- HORARIO PERMITIDO ---
   if(HoraInicio > 0 || HoraFin > 0) {
      MqlDateTime dtNow; TimeToStruct(TimeCurrent(), dtNow);
      bool fueraHorario = false;
      if(HoraInicio < HoraFin)
         fueraHorario = (dtNow.hour < HoraInicio || dtNow.hour >= HoraFin);
      else
         fueraHorario = (dtNow.hour < HoraInicio && dtNow.hour >= HoraFin);

      if(fueraHorario && total > 0) {
         // Cerrar solo las abiertas fuera de horario
         for(int i = total - 1; i >= 0; i--) {
            ulong tk = PositionGetTicket(i);
            if(!PositionSelectByTicket(tk)) continue;
            datetime openT = (datetime)PositionGetInteger(POSITION_TIME);
            MqlDateTime dtO; TimeToStruct(openT, dtO);
            bool aperturaFuera = false;
            if(HoraInicio < HoraFin)
               aperturaFuera = (dtO.hour < HoraInicio || dtO.hour >= HoraFin);
            else
               aperturaFuera = (dtO.hour < HoraInicio && dtO.hour >= HoraFin);
            if(aperturaFuera) {
               Log("RIESGO: Operacion fuera de horario. Cerrando: " + IntegerToString(tk));
               CerrarPosicion(tk, "Fuera de horario");
            }
         }
      }
   }

   // --- MAX OPERACIONES DIARIAS ---
   CheckMaxOperaciones();
}

//+------------------------------------------------------------------+
//| LOGICA MAX OPERACIONES DIARIAS                                    |
//|                                                                   |
//| Funcionamiento:                                                   |
//| - contadorDia lleva el numero de ops abiertas hoy                |
//| - Si hay posiciones abiertas y contadorDia > limite:             |
//|   cerrar las mas recientes hasta quedar en el limite             |
//| - Las primeras N ops (dentro del limite) nunca se tocan          |
//+------------------------------------------------------------------+
void CheckMaxOperaciones()
{
   if(MaxOperacionesDiarias <= 0) return;

   int total = PositionsTotal();
   if(total == 0) return;

   MqlDateTime dtHoy; TimeToStruct(TimeCurrent(), dtHoy);

   // Recopilar TODAS las posiciones abiertas HOY ordenadas por tiempo ASC
   ulong    tks[]; ArrayResize(tks, total);
   datetime tms[]; ArrayResize(tms, total);
   int n = 0;

   for(int i = 0; i < total; i++) {
      ulong tk = PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      datetime openT = (datetime)PositionGetInteger(POSITION_TIME);
      MqlDateTime dtO; TimeToStruct(openT, dtO);
      if(dtO.year == dtHoy.year && dtO.mon == dtHoy.mon && dtO.day == dtHoy.day) {
         tks[n] = tk;
         tms[n] = openT;
         n++;
      }
   }
   ArrayResize(tks, n);
   ArrayResize(tms, n);

   if(n == 0) return;

   // Contar ops YA CERRADAS hoy (solo DEAL_ENTRY_IN en historial)
   HistorySelect(TimeCurrent() - 86400, TimeCurrent());
   int cerradasHoy = 0;
   for(int i = 0; i < HistoryDealsTotal(); i++) {
      ulong dk = HistoryDealGetTicket(i);
      if(!dk) continue;
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(dk, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      datetime dt2 = (datetime)HistoryDealGetInteger(dk, DEAL_TIME);
      MqlDateTime md; TimeToStruct(dt2, md);
      if(md.year == dtHoy.year && md.mon == dtHoy.mon && md.day == dtHoy.day) {
         // Verificar que esta posicion YA ESTA CERRADA (no esta en las abiertas ahora)
         ulong posId = (ulong)HistoryDealGetInteger(dk, DEAL_POSITION_ID);
         bool estaAbierta = false;
         for(int j = 0; j < n; j++) {
            if(tks[j] == posId) { estaAbierta = true; break; }
         }
         if(!estaAbierta) cerradasHoy++;
      }
   }

   // Total aperturas del dia = cerradas + abiertas ahora
   int totalDia = cerradasHoy + n;

   Log("CHECK: totalDia=" + IntegerToString(totalDia) +
       " cerradas=" + IntegerToString(cerradasHoy) +
       " abiertasAhora=" + IntegerToString(n) +
       " limite=" + IntegerToString(MaxOperacionesDiarias));

   if(totalDia <= MaxOperacionesDiarias) return; // Todo dentro del limite

   // Ordenar abiertas por tiempo ASC (las mas antiguas primero = las validas)
   for(int a = 0; a < n-1; a++) {
      for(int b = a+1; b < n; b++) {
         if(tms[b] < tms[a]) {
            datetime tmp = tms[a]; tms[a] = tms[b]; tms[b] = tmp;
            ulong    tmk = tks[a]; tks[a] = tks[b]; tks[b] = tmk;
         }
      }
   }

   // Cuantas de las abiertas ahora estan dentro del limite
   int permitidasAbiertas = MaxOperacionesDiarias - cerradasHoy;
   if(permitidasAbiertas < 0) permitidasAbiertas = 0;

   // Cerrar SOLO las que estan fuera del limite (las mas recientes)
   for(int i = permitidasAbiertas; i < n; i++) {
      Log("RIESGO: Cerrando op #" + IntegerToString(cerradasHoy + i + 1) +
          " ticket=" + IntegerToString(tks[i]) +
          " (limite=" + IntegerToString(MaxOperacionesDiarias) + ")");
      CerrarPosicion(tks[i], "Excede limite diario");
      SendRiskEvent("max_ops", totalDia);
      Sleep(200);
   }
}

//+------------------------------------------------------------------+
//| CERRAR POSICION ESPECIFICA                                        |
//+------------------------------------------------------------------+
bool CerrarPosicion(ulong ticket, string motivo)
{
   if(!PositionSelectByTicket(ticket)) return false;
   MqlTradeRequest rq; MqlTradeResult rs;
   ZeroMemory(rq); ZeroMemory(rs);
   rq.action    = TRADE_ACTION_DEAL;
   rq.position  = ticket;
   rq.symbol    = PositionGetString(POSITION_SYMBOL);
   rq.volume    = PositionGetDouble(POSITION_VOLUME);
   rq.type      = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   rq.price     = rq.type == ORDER_TYPE_SELL ?
                  SymbolInfoDouble(rq.symbol, SYMBOL_BID) :
                  SymbolInfoDouble(rq.symbol, SYMBOL_ASK);
   rq.deviation = 30;
   rq.comment   = "TradyncApp: " + motivo;
   bool ok = OrderSend(rq, rs);
   if(ok) Log("Cerrado: " + IntegerToString(ticket) + " | " + motivo);
   else   Log("Error cerrando " + IntegerToString(ticket) + " | retcode: " + IntegerToString(rs.retcode));
   return ok;
}

void CerrarTodas(string motivo)
{
   for(int i = PositionsTotal()-1; i >= 0; i--) {
      ulong tk = PositionGetTicket(i);
      if(tk > 0) CerrarPosicion(tk, motivo);
   }
}

void SendRiskEvent(string tipo, double valor)
{
   string json = "{";
   json += "\\"tipo\\":\\"" + tipo + "\\",";
   json += "\\"valor\\":" + DoubleToString(valor, 2) + ",";
   json += "\\"account\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   json += "}";
   Post(ENDPOINT + "/mt-risk", json);
}

//+------------------------------------------------------------------+
//| REGISTRO DE CUENTA                                                |
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
//| SYNC POSICIONES                                                   |
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
      current[i].sl     = PositionGetDouble(POSITION_SL);
      current[i].tp     = PositionGetDouble(POSITION_TP);
      current[i].vol    = PositionGetDouble(POSITION_VOLUME);
      if(force || Changed(tk, current[i])) SendPos(tk);
   }
   ArrayCopy(posCache, current);
}

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
   if(StringFind(resp, "close_all") >= 0) CerrarTodas("Solicitud servidor");
   Log("Sync ticket " + IntegerToString(tk));
}

//+------------------------------------------------------------------+
//| OPERACIONES CERRADAS                                              |
//+------------------------------------------------------------------+
void CheckClosedTrades()
{
   HistorySelect(TimeCurrent() - 86400, TimeCurrent());
   int total = HistoryDealsTotal();
   for(int i = total-1; i >= 0; i--) {
      ulong dk = HistoryDealGetTicket(i);
      if(!dk) continue;
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(dk, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      if(Sent(dk)) continue;
      SendClosed(dk);
      MarkSent(dk);
   }
}

void SendClosed(ulong dk)
{
   ulong posId = HistoryDealGetInteger(dk, DEAL_POSITION_ID);
   double openPx = 0; datetime openT = 0; string tipo = "BUY";
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
   Log("Op cerrada. Ticket: " + IntegerToString(posId) +
       " | Profit: " + DoubleToString(HistoryDealGetDouble(dk, DEAL_PROFIT), 2));
}

//+------------------------------------------------------------------+
//| HTTP POST                                                         |
//+------------------------------------------------------------------+
string Post(string url, string body)
{
   string headers = "Content-Type: application/json\\r\\n"
                  + "X-Auth-Token: " + TOKEN + "\\r\\n"
                  + "Accept: application/json\\r\\n";
   uchar post[]; uchar result[]; string rh;
   StringToCharArray(body, post, 0, WHOLE_ARRAY, CP_UTF8);
   int sz = ArraySize(post);
   if(sz > 0 && post[sz-1] == 0) ArrayResize(post, sz-1);
   ResetLastError();
   int res = WebRequest("POST", url, headers, 5000, post, result, rh);
   if(res == -1) {
      int err = GetLastError();
      Log("ERROR HTTP " + IntegerToString(err) + " | " + url);
      if(err == 4060)
         Alert("Activa WebRequests: Herramientas > Opciones > Expert Advisors > Anadir: https://www.tradyncapp.com");
      return "";
   }
   Log("HTTP " + IntegerToString(res) + " " + url);
   return CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
}

//+------------------------------------------------------------------+
//| UTILIDADES                                                        |
//+------------------------------------------------------------------+
bool Changed(ulong tk, PosCache &p)
{
   for(int i = 0; i < ArraySize(posCache); i++) {
      if(posCache[i].ticket == tk)
         return MathAbs(posCache[i].sl-p.sl)>0.00001 ||
                MathAbs(posCache[i].tp-p.tp)>0.00001 ||
                MathAbs(posCache[i].vol-p.vol)>0.00001;
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
   StringReplace(s,"\\\\","\\\\\\\\"); StringReplace(s,"\\"","\\\\\\"");
   StringReplace(s,"\\n","\\\\n"); return s;
}
void Log(string msg) { if(EnableLogs) Print("TradyncSync: "+msg); }
//+------------------------------------------------------------------+
`;
const MT4_TEMPLATE=`//+------------------------------------------------------------------+
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
module.exports=async function(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  const userToken=req.query.token||req.headers['x-auth-token'];
  const platform=(req.query.platform||'mt5').toLowerCase();
  if(!userToken) return res.status(401).json({error:'Token requerido'});
  const r1=await fetch(`${SURL}/rest/v1/api_keys?token=eq.${encodeURIComponent(userToken)}&activo=eq.true&select=user_id`,
    {headers:{apikey:SKEY,Authorization:`Bearer ${SKEY}`}});
  const keys=await r1.json();
  if(!keys||!keys.length) return res.status(401).json({error:'Token invalido'});
  const template=platform==='mt4'?MT4_TEMPLATE:MT5_TEMPLATE;
  const eaContent=template.replace('PEGA_TU_TOKEN_AQUI',userToken);
  const ext=platform==='mt4'?'mq4':'mq5';
  res.setHeader('Content-Type','application/octet-stream');
  res.setHeader('Content-Disposition',`attachment; filename="TradyncSync_${platform.toUpperCase()}.${ext}"`);
  res.setHeader('Cache-Control','no-store');
  return res.send(eaContent);
};
