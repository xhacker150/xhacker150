/** Affiche les messages passés en paramètres d'URL (?succes=...&erreur=...). */
export function Messages({ succes, erreur, info }: { succes?: string; erreur?: string; info?: string }) {
  return (
    <>
      {succes && <div className="alerte succes">{succes}</div>}
      {erreur && <div className="alerte erreur">{erreur}</div>}
      {info && <div className="alerte info">{info}</div>}
    </>
  );
}
