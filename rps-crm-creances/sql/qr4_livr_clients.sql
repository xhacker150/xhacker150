-- DB: RPS NOUV BD
SELECT l.CT_Num, CONVERT(varchar(10),l.DO_Date,120) d, l.DO_Piece, l.AR_Ref, l.DL_Design, l.DL_Qte, l.DL_MontantHT, dp.DE_Intitule FROM F_DOCLIGNE l LEFT JOIN F_DEPOT dp ON l.DE_No=dp.DE_No WHERE l.DO_Domaine=0 AND l.DO_Type IN (6,7) AND l.CT_Num LIKE '411%' AND l.CT_Num NOT LIKE '41180%' AND l.DO_Date>='20251201' ORDER BY l.CT_Num, l.DO_Date
