import Link from "next/link";

export default function Introuvable() {
  return (
    <div className="connexion"><div className="card"><div className="logo"><b>RPS</b> <span>CRM CRÉANCES</span></div><p className="mt">Page introuvable.</p><Link className="btn" href="/dashboard">Tableau de bord</Link></div></div>
  );
}
