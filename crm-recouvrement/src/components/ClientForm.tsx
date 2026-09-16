import type { Client, Scenario, Profil } from "@/lib/types";
import { LIBELLES_STATUT_CLIENT, LIBELLES_TYPE_CLIENT } from "@/lib/format";

export function ClientForm({
  client,
  scenarios,
  agents,
  action,
  delaiDefaut,
}: {
  client?: Partial<Client>;
  scenarios: Scenario[];
  agents: Pick<Profil, "id" | "nom">[];
  action: (formData: FormData) => Promise<void>;
  delaiDefaut: number;
}) {
  const c = client ?? {};
  return (
    <form action={action} className="form">
      <div className="ligne ligne-3">
        <div className="champ">
          <label>Code client *</label>
          <input name="code" required defaultValue={c.code ?? ""} placeholder="CL001" maxLength={20} />
          <span className="aide">Identique au compte tiers Sage (411xxx) si possible.</span>
        </div>
        <div className="champ" style={{ gridColumn: "span 2" }}>
          <label>Raison sociale / Nom *</label>
          <input name="raison_sociale" required defaultValue={c.raison_sociale ?? ""} maxLength={200} />
        </div>
      </div>
      <div className="ligne ligne-4">
        <div className="champ">
          <label>Type</label>
          <select name="type" defaultValue={c.type ?? "entreprise"}>
            {Object.entries(LIBELLES_TYPE_CLIENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="champ">
          <label>NIF</label>
          <input name="nif" defaultValue={c.nif ?? ""} />
        </div>
        <div className="champ">
          <label>RCCM</label>
          <input name="rccm" defaultValue={c.rccm ?? ""} />
        </div>
        <div className="champ">
          <label>Référence Sage</label>
          <input name="reference_sage" defaultValue={c.reference_sage ?? ""} />
        </div>
      </div>
      <div className="ligne ligne-3">
        <div className="champ">
          <label>Téléphone</label>
          <input name="telephone" defaultValue={c.telephone ?? ""} placeholder="+227 ..." />
        </div>
        <div className="champ">
          <label>E-mail (relances)</label>
          <input name="email" type="email" defaultValue={c.email ?? ""} />
        </div>
        <div className="champ">
          <label>Ville</label>
          <input name="ville" defaultValue={c.ville ?? ""} />
        </div>
      </div>
      <div className="ligne ligne-3">
        <div className="champ" style={{ gridColumn: "span 2" }}>
          <label>Adresse</label>
          <input name="adresse" defaultValue={c.adresse ?? ""} />
        </div>
        <div className="champ">
          <label>Pays</label>
          <input name="pays" defaultValue={c.pays ?? "Niger"} />
        </div>
      </div>
      <div className="ligne">
        <div className="champ">
          <label>Contact principal</label>
          <input name="contact_nom" defaultValue={c.contact_nom ?? ""} />
        </div>
        <div className="champ">
          <label>Fonction du contact</label>
          <input name="contact_fonction" defaultValue={c.contact_fonction ?? ""} />
        </div>
      </div>
      <div className="ligne ligne-4">
        <div className="champ">
          <label>Délai de paiement (jours)</label>
          <input name="delai_paiement_jours" type="number" min={0} defaultValue={c.delai_paiement_jours ?? delaiDefaut} />
        </div>
        <div className="champ">
          <label>Plafond de crédit</label>
          <input name="plafond_credit" type="number" min={0} step="1" defaultValue={c.plafond_credit ?? 0} />
          <span className="aide">0 = illimité</span>
        </div>
        <div className="champ">
          <label>Statut</label>
          <select name="statut" defaultValue={c.statut ?? "actif"}>
            {Object.entries(LIBELLES_STATUT_CLIENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="champ">
          <label>Scénario de relance</label>
          <select name="scenario_id" defaultValue={c.scenario_id ?? ""}>
            <option value="">Scénario par défaut</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </select>
        </div>
      </div>
      <div className="ligne">
        <div className="champ">
          <label>Agent de recouvrement</label>
          <select name="agent_id" defaultValue={c.agent_id ?? ""}>
            <option value="">Non affecté</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
          </select>
        </div>
        <div className="champ">
          <label>Notes internes</label>
          <textarea name="notes" rows={2} defaultValue={c.notes ?? ""} />
        </div>
      </div>
      <div className="pied">
        <a href={c.id ? `/clients/${c.id}` : "/clients"} className="btn">Annuler</a>
        <button type="submit" className="btn primary">Enregistrer</button>
      </div>
    </form>
  );
}
