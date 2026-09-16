import { Sidebar } from "@/components/Sidebar";
import { exigerProfil } from "@/lib/session";
import { LIBELLES_ROLE } from "@/lib/format";
import { seDeconnecter } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profil } = await exigerProfil();
  return (
    <div className="app">
      <Sidebar nom={profil.nom} role={LIBELLES_ROLE[profil.role] ?? profil.role} deconnexion={seDeconnecter} />
      <main className="contenu">{children}</main>
    </div>
  );
}
