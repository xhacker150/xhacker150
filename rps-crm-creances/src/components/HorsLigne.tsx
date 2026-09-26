"use client";
import { useEffect, useState } from "react";

/** Enregistre le service worker et affiche un bandeau quand le réseau tombe (mode dégradé lecture). */
export function HorsLigne({ renduLe }: { renduLe: string }) {
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const maj = () => setHorsLigne(!navigator.onLine);
    maj();
    window.addEventListener("online", maj);
    window.addEventListener("offline", maj);
    return () => { window.removeEventListener("online", maj); window.removeEventListener("offline", maj); };
  }, []);
  if (!horsLigne) return null;
  return <div className="warn">📵 Hors ligne — page telle que vue le {renduLe}. Les chiffres sont ceux de cette date ; les actions sont désactivées jusqu&apos;au retour du réseau.</div>;
}
