-- DB: RPS BD 26
SELECT CT_Num, CONVERT(varchar(10),EC_Date,120) d, JO_Num, EC_Piece, EC_RefPiece, EC_Intitule, EC_Sens, EC_Montant FROM F_ECRITUREC WHERE CT_Num LIKE '411%' AND CT_Num NOT LIKE '41180%' ORDER BY CT_Num, EC_Date, EC_No
