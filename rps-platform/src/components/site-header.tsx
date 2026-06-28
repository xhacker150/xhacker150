/** En-tête réseau RPS : bordure rouge + bandeau signature dégradé (charte §4). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50">
      <div className="flex items-center gap-4 border-b-[3px] border-rps-rouge bg-card px-6 py-3 shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rps-rouge font-heading text-lg font-extrabold text-white">
          RPS
        </div>
        <div>
          <p className="font-heading text-lg font-extrabold tracking-tight">
            RPS — Pilotage réseau
          </p>
          <p className="text-xs text-rps-mut">
            Rissa Petroleum Service · Niger
          </p>
        </div>
      </div>
      <div className="rps-bandeau" />
    </header>
  );
}
