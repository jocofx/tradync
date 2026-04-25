// api/download-ea.js v6.2
const SURL=process.env.SUPABASE_URL;
const SKEY=process.env.SUPABASE_SERVICE_KEY;
const MT5_TEMPLATE=`//+------------------------------------------------------------------+
//|                                           TradyncSync_MT5.mq5    |
//|          Journal + Gestor de Riesgo + Analisis Conductual        |
//|                                      https://tradyncapp.com       |
//+------------------------------------------------------------------+
#property copyright "TradyncApp.com"
#property link      "https://tradyncapp.com"
#property version   "6.00"
#property strict

//+------------------------------------------------------------------+
//| PARAMETROS — SINCRONIZACION                                       |
//+------------------------------------------------------------------+
input group "=== SINCRONIZACION ==="
input int    SyncInterval          = 3;    // Intervalo sync (seg)
input bool   EnableLogs            = true; // Activar logs

//+------------------------------------------------------------------+
//| PARAMETROS — GESTOR DE RIESGO                                     |
//+------------------------------------------------------------------+
input group "=== GESTOR DE RIESGO ==="
input bool   EnableRiskManager     = true; // Activar gestor de riesgo
input int    MaxOperacionesDiarias = 0;    // Max operaciones por dia (0=sin limite)
input double LimiteGananciaDiaria  = 0;    // Limite ganancia $ (0=sin limite)
input double LimitePerdidaDiaria   = 0;    // Limite perdida $ (0=sin limite)
input int    HoraInicio            = 0;    // Hora inicio permitida (0=sin limite)
input int    HoraFin               = 0;    // Hora fin permitida (0=sin limite)

//+------------------------------------------------------------------+
//| PARAMETROS — ANALISIS CONDUCTUAL                                  |
//+------------------------------------------------------------------+
input group "=== ANALISIS CONDUCTUAL ==="
input bool   ActivarAnalisisConductual = true;  // Activar analisis conductual
input string SensibilidadSistema       = "medium"; // Sensibilidad: low / medium / high
input bool   ActivarFeedback           = true;  // Mostrar mensajes en diario
input bool   ActivarModoRestrictivo    = false; // Bloquear ops cuando score alto
input int    LimiteBloqueoScore        = 30;    // Score para activar bloqueo
input int    DecadenciaPuntosDia       = 2;     // Puntos que se restan por dia correcto
input int    MinutosEntreOpsImpulsivo  = 5;     // Minutos minimos entre ops (impulsividad)

//+------------------------------------------------------------------+
//| VARIABLES INTERNAS — SYNC                                         |
//+------------------------------------------------------------------+
string TOKEN    = "PEGA_TU_TOKEN_AQUI";
string ENDPOINT = "https://www.tradyncapp.com/api";

struct PosCache { ulong ticket; double sl; double tp; double vol; };
PosCache posCache[];
ulong    sentTickets[];

//+------------------------------------------------------------------+
//| VARIABLES INTERNAS — RIESGO                                       |
//+------------------------------------------------------------------+
ulong  ticketsValidosHoy[];
int    contadorValidosHoy;
string diaActual;
double balanceInicio;
bool   limitePerdidaAlcanzado;
bool   limiteGananciaAlcanzado;

//+------------------------------------------------------------------+
//| VARIABLES INTERNAS — CONDUCTUAL                                   |
//+------------------------------------------------------------------+
// Nombre de variables globales del terminal (persisten entre reinicios)
string GV_SCORE       = "TRADYNC_SCORE";
string GV_LAST_CLOSE  = "TRADYNC_LAST_CLOSE";
string GV_VIOLA_DIA   = "TRADYNC_VIOLA_HOY";
string GV_LAST_DECAY  = "TRADYNC_LAST_DECAY";
string GV_REINTENTOS  = "TRADYNC_REINTENTOS";
string GV_LAST_BLOCK  = "TRADYNC_LAST_BLOCK";

double scoreActual;       // Score conductual actual
int    violacionesHoy;    // Violaciones del dia actual
datetime ultimaCierre;    // Ultima operacion cerrada (para impulsividad)
int    reintentosBloqueo; // Reintentos tras bloqueo

// Multiplicadores por sensibilidad
double multScore;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(TOKEN) < 10) {
      Alert("Token no valido. Descarga el EA desde TradyncApp > Conectar Broker.");
      return INIT_FAILED;
   }

   // Configurar multiplicador de sensibilidad
   if(SensibilidadSistema == "low")       multScore = 0.5;
   else if(SensibilidadSistema == "high") multScore = 2.0;
   else                                   multScore = 1.0; // medium

   // Inicializar sistema conductual
   InicializarConductual();

   // Inicializar dia de riesgo
   InicializarDia();

   Log("TradyncSync v6 iniciado. Cuenta: " +
       IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)));
   Log("Score actual: " + DoubleToString(scoreActual, 1) +
       " | Perfil: " + GetPerfil() +
       " | Disciplina: " + IntegerToString(GetIndiceDisciplina()) + "/100");

   if(EnableRiskManager && MaxOperacionesDiarias > 0)
      Log("Limite diario: " + IntegerToString(MaxOperacionesDiarias) + " ops");

   RegisterAccount();
   SyncPositions(true);
   EventSetTimer(SyncInterval);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   // Guardar score al salir
   GlobalVariableSet(GV_SCORE, scoreActual);
}

void OnTimer()
{
   VerificarCambioDia();
   SyncPositions(false);
   CheckClosedTrades();
   if(EnableRiskManager)       GestorRiesgo();
   if(ActivarAnalisisConductual) ActualizarConductual();
}

void OnTrade()
{
   Sleep(500);
   VerificarCambioDia();
   SyncPositions(false);
   CheckClosedTrades();
   if(EnableRiskManager)       GestorRiesgo();
   if(ActivarAnalisisConductual) ActualizarConductual();
}

//+------------------------------------------------------------------+
//| SISTEMA CONDUCTUAL — INICIALIZACION                               |
//+------------------------------------------------------------------+
void InicializarConductual()
{
   // Recuperar score guardado (persiste entre reinicios)
   if(GlobalVariableCheck(GV_SCORE))
      scoreActual = GlobalVariableGet(GV_SCORE);
   else
      scoreActual = 0;

   // Recuperar ultima cierre
   if(GlobalVariableCheck(GV_LAST_CLOSE))
      ultimaCierre = (datetime)GlobalVariableGet(GV_LAST_CLOSE);
   else
      ultimaCierre = 0;

   violacionesHoy   = 0;
   reintentosBloqueo = 0;

   // Aplicar decaimiento diario si corresponde
   AplicarDecaimiento();
}

//+------------------------------------------------------------------+
//| DECAIMIENTO DIARIO DEL SCORE                                      |
//+------------------------------------------------------------------+
void AplicarDecaimiento()
{
   if(DecadenciaPuntosDia <= 0) return;

   datetime ahora = TimeCurrent();
   datetime ultimoDecay = 0;
   if(GlobalVariableCheck(GV_LAST_DECAY))
      ultimoDecay = (datetime)GlobalVariableGet(GV_LAST_DECAY);

   // Calcular dias transcurridos desde ultimo decaimiento
   if(ultimoDecay > 0) {
      MqlDateTime dtUltimo; TimeToStruct(ultimoDecay, dtUltimo);
      MqlDateTime dtAhora;  TimeToStruct(ahora, dtAhora);
      int diasPasados = dtAhora.day_of_year - dtUltimo.day_of_year;
      if(dtAhora.year > dtUltimo.year) diasPasados += 365;

      if(diasPasados > 0) {
         double decay = diasPasados * DecadenciaPuntosDia;
         scoreActual = MathMax(0, scoreActual - decay);
         GlobalVariableSet(GV_SCORE, scoreActual);
         GlobalVariableSet(GV_LAST_DECAY, (double)ahora);
         if(diasPasados >= 1)
            Feedback("DIA_CORRECTO", diasPasados);
      }
   } else {
      GlobalVariableSet(GV_LAST_DECAY, (double)ahora);
   }
}

//+------------------------------------------------------------------+
//| ANADIR PUNTOS AL SCORE                                            |
//+------------------------------------------------------------------+
void AnadirScore(double puntos, string evento)
{
   double puntosAjustados = puntos * multScore;
   scoreActual += puntosAjustados;
   if(scoreActual < 0) scoreActual = 0;
   violacionesHoy++;
   GlobalVariableSet(GV_SCORE, scoreActual);

   Log("CONDUCTUAL [" + evento + "] +" + DoubleToString(puntosAjustados, 1) +
       " pts | Score: " + DoubleToString(scoreActual, 1) +
       " | Perfil: " + GetPerfil() +
       " | Disciplina: " + IntegerToString(GetIndiceDisciplina()) + "/100");

   Feedback(evento, 0);
}

//+------------------------------------------------------------------+
//| ACTUALIZACION CONDUCTUAL EN TIEMPO REAL                           |
//+------------------------------------------------------------------+
void ActualizarConductual()
{
   // Mostrar estado en comentario del grafico
   string comentario = "TradyncApp | Score: " + DoubleToString(scoreActual, 0) +
                       " | " + GetPerfil() +
                       " | Disciplina: " + IntegerToString(GetIndiceDisciplina()) + "/100" +
                       " | Violaciones hoy: " + IntegerToString(violacionesHoy);
   Comment(comentario);

   // Sincronizar score con servidor cada 60 segundos
   static datetime ultimoSyncScore = 0;
   if(TimeCurrent() - ultimoSyncScore > 60) {
      SyncScore();
      ultimoSyncScore = TimeCurrent();
   }
}

void SyncScore()
{
   string json = "{";
   json += "\\"account\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   json += "\\"score\\":" + DoubleToString(scoreActual,1) + ",";
   json += "\\"perfil\\":\\"" + GetPerfil() + "\\",";
   json += "\\"disciplina\\":" + IntegerToString(GetIndiceDisciplina()) + ",";
   json += "\\"violaciones_hoy\\":" + IntegerToString(violacionesHoy) + ",";
   json += "\\"balance\\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),2) + ",";
   json += "\\"equity\\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),2) + ",";
   json += "\\"pnl_dia\\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY)-balanceInicio,2);
   json += "}";
   Post(ENDPOINT + "/mt-score", json);
}

void CheckImpulsividad(datetime openTime)
{
   if(ultimaCierre == 0) return;
   if(MinutosEntreOpsImpulsivo <= 0) return;

   int segundosDesdeUltimaCierre = (int)(openTime - ultimaCierre);
   int limiteSegundos = MinutosEntreOpsImpulsivo * 60;

   if(segundosDesdeUltimaCierre > 0 && segundosDesdeUltimaCierre < limiteSegundos) {
      AnadirScore(1, "IMPULSIVIDAD");
   }
}

//+------------------------------------------------------------------+
//| PERFIL Y METRICAS                                                 |
//+------------------------------------------------------------------+
string GetPerfil()
{
   if(scoreActual <= 5)  return "Disciplinado";
   if(scoreActual <= 10) return "Levemente impulsivo";
   if(scoreActual <= 20) return "Indisciplinado";
   if(scoreActual <= 35) return "Alto riesgo";
   return "Trading compulsivo";
}

int GetIndiceDisciplina()
{
   int indice = 100 - (int)scoreActual;
   if(indice < 0)   indice = 0;
   if(indice > 100) indice = 100;
   return indice;
}

//+------------------------------------------------------------------+
//| FEEDBACK AUTOMATICO                                               |
//+------------------------------------------------------------------+
void Feedback(string evento, int extra)
{
   if(!ActivarFeedback) return;

   string msg = "";
   if(evento == "EXCESO_OPS")
      msg = "⚠️ Has superado el limite diario de operaciones. Score: " +
            DoubleToString(scoreActual, 0);
   else if(evento == "OPERATIVA_TRAS_PERDIDA")
      msg = "🚨 Posible trading por venganza detectado. Toma un descanso.";
   else if(evento == "OVERTRADING")
      msg = "📊 Sobreoperacion detectada. Reduce la frecuencia de tus entradas.";
   else if(evento == "IMPULSIVIDAD")
      msg = "📉 Operacion impulsiva detectada. Esperaste menos de " +
            IntegerToString(MinutosEntreOpsImpulsivo) + " minutos entre ops.";
   else if(evento == "FUERA_HORARIO")
      msg = "🕐 Operacion fuera del horario permitido.";
   else if(evento == "REINTENTOS_BLOQUEO")
      msg = "🔁 Multiples reintentos tras bloqueo. Señal de impulsividad alta.";
   else if(evento == "BLOQUEO_ACTIVO")
      msg = "🔒 Modo restrictivo activo. Score " + DoubleToString(scoreActual, 0) +
            " >= " + IntegerToString(LimiteBloqueoScore) +
            ". Nuevas operaciones bloqueadas.";
   else if(evento == "DIA_CORRECTO") {
      if(extra >= 1)
         msg = "✅ " + IntegerToString(extra) + " dia(s) siguiendo las reglas. " +
               "Score reducido. Disciplina: " +
               IntegerToString(GetIndiceDisciplina()) + "/100";
   }

   if(msg != "") Print("TradyncSync FEEDBACK: " + msg);
}

//+------------------------------------------------------------------+
//| GESTION DEL DIA                                                   |
//+------------------------------------------------------------------+
void InicializarDia()
{
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt);
   diaActual             = StringFormat("%04d.%02d.%02d", dt.year, dt.mon, dt.day);
   balanceInicio         = AccountInfoDouble(ACCOUNT_BALANCE);
   limitePerdidaAlcanzado  = false;
   limiteGananciaAlcanzado = false;
   ArrayResize(ticketsValidosHoy, 0);
   contadorValidosHoy    = 0;
   violacionesHoy        = 0;

   // Recuperar posiciones ya abiertas hoy al arrancar
   if(MaxOperacionesDiarias > 0) {
      int total = PositionsTotal();
      for(int i = 0; i < total; i++) {
         ulong tk = PositionGetTicket(i);
         if(!PositionSelectByTicket(tk)) continue;
         datetime openT = (datetime)PositionGetInteger(POSITION_TIME);
         MqlDateTime dtO; TimeToStruct(openT, dtO);
         if(dtO.year == dt.year && dtO.mon == dt.mon && dtO.day == dt.day) {
            if(contadorValidosHoy < MaxOperacionesDiarias) {
               int sz = ArraySize(ticketsValidosHoy);
               ArrayResize(ticketsValidosHoy, sz+1);
               ticketsValidosHoy[sz] = tk;
               contadorValidosHoy++;
            }
         }
      }
   }

   Log("Dia: " + diaActual +
       " | Ops validas: " + IntegerToString(contadorValidosHoy) +
       " | Score: " + DoubleToString(scoreActual, 1) +
       " | Disciplina: " + IntegerToString(GetIndiceDisciplina()) + "/100");
}

void VerificarCambioDia()
{
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt);
   string hoy = StringFormat("%04d.%02d.%02d", dt.year, dt.mon, dt.day);
   if(hoy != diaActual) {
      Log("Nuevo dia. Reiniciando contadores.");
      AplicarDecaimiento();
      InicializarDia();
   }
}

//+------------------------------------------------------------------+
//| GESTOR DE RIESGO                                                  |
//+------------------------------------------------------------------+
void GestorRiesgo()
{
   // LIMITE DE PERDIDA
   if(LimitePerdidaDiaria > 0 && !limitePerdidaAlcanzado) {
      double pnl = AccountInfoDouble(ACCOUNT_EQUITY) - balanceInicio;
      if(pnl <= -MathAbs(LimitePerdidaDiaria)) {
         limitePerdidaAlcanzado = true;
         Log("RIESGO: Limite perdida alcanzado. Cerrando todo.");
         CerrarTodas("Limite perdida diaria");
         return;
      }
   }

   // LIMITE DE GANANCIA
   if(LimiteGananciaDiaria > 0 && !limiteGananciaAlcanzado) {
      double pnl = AccountInfoDouble(ACCOUNT_EQUITY) - balanceInicio;
      if(pnl >= MathAbs(LimiteGananciaDiaria)) {
         limiteGananciaAlcanzado = true;
         Log("RIESGO: Limite ganancia alcanzado. Cerrando todo.");
         CerrarTodas("Limite ganancia diaria");
         return;
      }
   }

   // HORARIO
   if(HoraInicio > 0 || HoraFin > 0) {
      MqlDateTime dtN; TimeToStruct(TimeCurrent(), dtN);
      bool fuera = HoraInicio < HoraFin
         ? (dtN.hour < HoraInicio || dtN.hour >= HoraFin)
         : (dtN.hour < HoraInicio && dtN.hour >= HoraFin);
      if(fuera) {
         for(int i = PositionsTotal()-1; i >= 0; i--) {
            ulong tk = PositionGetTicket(i);
            if(!PositionSelectByTicket(tk)) continue;
            datetime openT = (datetime)PositionGetInteger(POSITION_TIME);
            MqlDateTime dtO; TimeToStruct(openT, dtO);
            bool fueraAp = HoraInicio < HoraFin
               ? (dtO.hour < HoraInicio || dtO.hour >= HoraFin)
               : (dtO.hour < HoraInicio && dtO.hour >= HoraFin);
            if(fueraAp) {
               if(ActivarAnalisisConductual)
                  AnadirScore(1, "FUERA_HORARIO");
               CerrarPosicion(tk, "Fuera de horario");
            }
         }
      }
   }

   // MAX OPERACIONES
   CheckMaxOps();
}

//+------------------------------------------------------------------+
//| MAX OPERACIONES DIARIAS                                           |
//+------------------------------------------------------------------+
void CheckMaxOps()
{
   if(MaxOperacionesDiarias <= 0) return;
   int total = PositionsTotal();
   if(total == 0) return;

   MqlDateTime dtH; TimeToStruct(TimeCurrent(), dtH);

   for(int i = total-1; i >= 0; i--) {
      ulong tk = PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;

      datetime openT = (datetime)PositionGetInteger(POSITION_TIME);
      MqlDateTime dtO; TimeToStruct(openT, dtO);
      if(dtO.year != dtH.year || dtO.mon != dtH.mon || dtO.day != dtH.day)
         continue;

      // Ver si ya es valida
      bool esValida = false;
      for(int j = 0; j < ArraySize(ticketsValidosHoy); j++) {
         if(ticketsValidosHoy[j] == tk) { esValida = true; break; }
      }
      if(esValida) continue;

      if(contadorValidosHoy < MaxOperacionesDiarias) {
         // Verificar modo restrictivo (inline para evitar forward reference)
         bool bloqueado = false;
         if(ActivarAnalisisConductual && ActivarModoRestrictivo && scoreActual >= LimiteBloqueoScore) {
            bloqueado = true;
            datetime ahora = TimeCurrent();
            datetime ultimoBloqueo = 0;
            if(GlobalVariableCheck(GV_LAST_BLOCK))
               ultimoBloqueo = (datetime)GlobalVariableGet(GV_LAST_BLOCK);
            if(ultimoBloqueo > 0 && (ahora - ultimoBloqueo) < 60) {
               reintentosBloqueo++;
               if(reintentosBloqueo >= 2) AnadirScore(2, "REINTENTOS_BLOQUEO");
            } else { reintentosBloqueo = 0; }
            GlobalVariableSet(GV_LAST_BLOCK, (double)ahora);
            Log("MODO RESTRICTIVO: Score " + DoubleToString(scoreActual,0) +
                " >= " + IntegerToString(LimiteBloqueoScore) +
                ". Bloqueando ticket " + IntegerToString(tk));
            Feedback("BLOQUEO_ACTIVO", 0);
         }
         if(bloqueado) {
            CerrarPosicion(tk, "Modo restrictivo activo");
            continue;
         }
         // Verificar impulsividad
         if(ActivarAnalisisConductual)
            CheckImpulsividad(openT);
         // Marcar como valida
         int sz = ArraySize(ticketsValidosHoy);
         ArrayResize(ticketsValidosHoy, sz+1);
         ticketsValidosHoy[sz] = tk;
         contadorValidosHoy++;
         Log("Op valida #" + IntegerToString(contadorValidosHoy) +
             " ticket=" + IntegerToString(tk));
      } else {
         // Fuera del limite
         if(ActivarAnalisisConductual) {
            AnadirScore(2, "EXCESO_OPS");
            if(limitePerdidaAlcanzado)
               AnadirScore(3, "OPERATIVA_TRAS_PERDIDA");
         }
         CerrarPosicion(tk, "Excede limite diario");
      }
   }

   // Detectar overtrading (muchas ops en poco tiempo)
   if(ActivarAnalisisConductual && contadorValidosHoy >= 3) {
      CheckOvertrading();
   }
}

//+------------------------------------------------------------------+
//| DETECTAR OVERTRADING                                              |
//+------------------------------------------------------------------+
void CheckOvertrading()
{
   if(PositionsTotal() < 2) return;

   // Contar ops abiertas en los ultimos 10 minutos
   int opsRecientes = 0;
   datetime hace10min = TimeCurrent() - 600;
   MqlDateTime dtH; TimeToStruct(TimeCurrent(), dtH);

   for(int i = 0; i < PositionsTotal(); i++) {
      ulong tk = PositionGetTicket(i);
      if(!PositionSelectByTicket(tk)) continue;
      datetime openT = (datetime)PositionGetInteger(POSITION_TIME);
      MqlDateTime dtO; TimeToStruct(openT, dtO);
      if(dtO.year == dtH.year && dtO.mon == dtH.mon && dtO.day == dtH.day)
         if(openT >= hace10min) opsRecientes++;
   }

   if(opsRecientes >= 3)
      AnadirScore(1, "OVERTRADING");
}

//+------------------------------------------------------------------+
//| CERRAR POSICIONES                                                 |
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
   rq.type      = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY
                  ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   rq.price     = rq.type == ORDER_TYPE_SELL
                  ? SymbolInfoDouble(rq.symbol, SYMBOL_BID)
                  : SymbolInfoDouble(rq.symbol, SYMBOL_ASK);
   rq.deviation = 30;
   rq.comment   = "TradyncApp: " + motivo;
   bool ok = OrderSend(rq, rs);
   if(ok) Log("Cerrado: " + IntegerToString(ticket) + " | " + motivo);
   else   Log("Error cerrando " + IntegerToString(ticket) +
              " retcode=" + IntegerToString(rs.retcode));
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
   string json = "{\\"tipo\\":\\"" + tipo + "\\","
               + "\\"valor\\":" + DoubleToString(valor,2) + ","
               + "\\"score\\":" + DoubleToString(scoreActual,1) + ","
               + "\\"perfil\\":\\"" + GetPerfil() + "\\","
               + "\\"disciplina\\":" + IntegerToString(GetIndiceDisciplina()) + ","
               + "\\"account\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "}";
   Post(ENDPOINT + "/mt-risk", json);
}

//+------------------------------------------------------------------+
//| REGISTRO DE CUENTA                                                |
//+------------------------------------------------------------------+
void RegisterAccount()
{
   string tipo = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)
                 == ACCOUNT_TRADE_MODE_DEMO ? "demo" : "real";

   // Configuracion de riesgo del EA
   string riskConfig = "{"
      + "\\"max_ops\\":" + IntegerToString(MaxOperacionesDiarias) + ","
      + "\\"limite_perdida\\":" + DoubleToString(LimitePerdidaDiaria,2) + ","
      + "\\"limite_ganancia\\":" + DoubleToString(LimiteGananciaDiaria,2) + ","
      + "\\"hora_inicio\\":" + IntegerToString(HoraInicio) + ","
      + "\\"hora_fin\\":" + IntegerToString(HoraFin) + ","
      + "\\"risk_manager\\":" + (EnableRiskManager ? "true" : "false") + ","
      + "\\"conductual\\":" + (ActivarAnalisisConductual ? "true" : "false") + ","
      + "\\"modo_restrictivo\\":" + (ActivarModoRestrictivo ? "true" : "false") + ","
      + "\\"limite_bloqueo\\":" + IntegerToString(LimiteBloqueoScore)
      + "}";

   string json = "{"
      + "\\"account_number\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ","
      + "\\"broker\\":\\"" + EscJ(AccountInfoString(ACCOUNT_COMPANY)) + "\\","
      + "\\"server\\":\\"" + EscJ(AccountInfoString(ACCOUNT_SERVER)) + "\\","
      + "\\"currency\\":\\"" + EscJ(AccountInfoString(ACCOUNT_CURRENCY)) + "\\","
      + "\\"leverage\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)) + ","
      + "\\"balance\\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),2) + ","
      + "\\"platform\\":\\"MT5\\"," 
      + "\\"account_type\\":\\"" + tipo + "\\","
      + "\\"risk_config\\":" + riskConfig + ","
      + "\\"score\\":" + DoubleToString(scoreActual,1) + ","
      + "\\"perfil\\":\\"" + GetPerfil() + "\\","
      + "\\"disciplina\\":" + IntegerToString(GetIndiceDisciplina())
      + "}";
   Log("Cuenta: " + Post(ENDPOINT + "/mt-register", json));
}

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
   string json = "{"
      + "\\"ticket\\":" + IntegerToString(tk) + ","
      + "\\"symbol\\":\\"" + EscJ(PositionGetString(POSITION_SYMBOL)) + "\\","
      + "\\"type\\":\\"" + tipo + "\\","
      + "\\"volume\\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME),2) + ","
      + "\\"open_price\\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN),5) + ","
      + "\\"sl\\":" + DoubleToString(PositionGetDouble(POSITION_SL),5) + ","
      + "\\"tp\\":" + DoubleToString(PositionGetDouble(POSITION_TP),5) + ","
      + "\\"open_time\\":\\"" + FmtDT((datetime)PositionGetInteger(POSITION_TIME)) + "\\","
      + "\\"profit\\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT),2) + ","
      + "\\"swap\\":" + DoubleToString(PositionGetDouble(POSITION_SWAP),2) + ","
      + "\\"comment\\":\\"" + EscJ(PositionGetString(POSITION_COMMENT)) + "\\","
      + "\\"magic\\":" + IntegerToString(PositionGetInteger(POSITION_MAGIC)) + ","
      + "\\"account\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
      + "}";
   string resp = Post(ENDPOINT + "/mt-sync", json);
   if(StringFind(resp, "close_all") >= 0) CerrarTodas("Solicitud servidor");
   Log("Sync " + IntegerToString(tk));
}

//+------------------------------------------------------------------+
//| OPERACIONES CERRADAS                                              |
//+------------------------------------------------------------------+
void CheckClosedTrades()
{
   HistorySelect(TimeCurrent()-86400, TimeCurrent());
   for(int i = HistoryDealsTotal()-1; i >= 0; i--) {
      ulong dk = HistoryDealGetTicket(i);
      if(!dk) continue;
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(dk,DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      if(Sent(dk)) continue;

      // Actualizar ultima cierre para deteccion de impulsividad
      datetime closeT = (datetime)HistoryDealGetInteger(dk, DEAL_TIME);
      if(closeT > ultimaCierre) {
         ultimaCierre = closeT;
         GlobalVariableSet(GV_LAST_CLOSE, (double)ultimaCierre);
      }

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
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(d,DEAL_ENTRY) == DEAL_ENTRY_IN) {
         openPx = HistoryDealGetDouble(d, DEAL_PRICE);
         openT  = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
         tipo   = HistoryDealGetInteger(d,DEAL_TYPE) == DEAL_TYPE_BUY ? "BUY" : "SELL";
         break;
      }
   }
   string json = "{"
      + "\\"ticket\\":" + IntegerToString(posId) + ","
      + "\\"symbol\\":\\"" + EscJ(HistoryDealGetString(dk,DEAL_SYMBOL)) + "\\","
      + "\\"type\\":\\"" + tipo + "\\","
      + "\\"volume\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_VOLUME),2) + ","
      + "\\"open_price\\":" + DoubleToString(openPx,5) + ","
      + "\\"close_price\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_PRICE),5) + ","
      + "\\"open_time\\":\\"" + FmtDT(openT) + "\\","
      + "\\"close_time\\":\\"" + FmtDT((datetime)HistoryDealGetInteger(dk,DEAL_TIME)) + "\\","
      + "\\"profit\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_PROFIT),2) + ","
      + "\\"swap\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_SWAP),2) + ","
      + "\\"commission\\":" + DoubleToString(HistoryDealGetDouble(dk,DEAL_COMMISSION),2) + ","
      + "\\"comment\\":\\"" + EscJ(HistoryDealGetString(dk,DEAL_COMMENT)) + "\\","
      + "\\"magic\\":" + IntegerToString(HistoryDealGetInteger(dk,DEAL_MAGIC)) + ","
      + "\\"account\\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
      + "}";
   Post(ENDPOINT + "/mt-trade", json);
   Log("Cerrada " + IntegerToString(posId) +
       " profit=" + DoubleToString(HistoryDealGetDouble(dk,DEAL_PROFIT),2));
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
      Log("ERROR HTTP " + IntegerToString(err));
      if(err == 4060)
         Alert("Activa WebRequests: https://www.tradyncapp.com");
      return "";
   }
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
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       m.year,m.mon,m.day,m.hour,m.min,m.sec);
}
string EscJ(string s) {
   StringReplace(s,"\\\\","\\\\\\\\");
   StringReplace(s,"\\"","\\\\\\"");
   StringReplace(s,"\\n","\\\\n");
   return s;
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
