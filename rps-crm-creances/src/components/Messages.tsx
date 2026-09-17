export function Messages({ succes, erreur, info }: { succes?: string; erreur?: string; info?: string }) {
  const e = erreur === "acces_refuse" ? "Accès réservé : vos droits ne permettent pas cette action." : erreur;
  return (
    <>
      {succes && <div className="ok">{succes}</div>}
      {e && <div className="warn">{e}</div>}
      {info && <div className="info">{info}</div>}
    </>
  );
}
