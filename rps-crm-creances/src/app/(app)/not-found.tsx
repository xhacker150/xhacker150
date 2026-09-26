import Link from "next/link";

export default function PageIntrouvable() {
  return (
    <div className="card">
      <h3>Page ou client introuvable</h3>
      <p>Ce compte n&apos;existe pas dans l&apos;extraction active, ou l&apos;adresse est erronée.</p>
      <Link className="btn" href="/clients">← Liste des clients</Link>
    </div>
  );
}
