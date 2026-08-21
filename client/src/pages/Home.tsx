import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { Archive, ArrowRight, Check, CircleAlert, FileArchive, ImageOff, Info, Loader2, LockKeyhole, ScanSearch, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type InspectedImage = {
  id: string;
  detailUrl: string;
  previewUrl?: string;
  originalUrl?: string;
  resolutionNote?: string;
};

export default function Home() {
  const [galleryUrl, setGalleryUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [images, setImages] = useState<InspectedImage[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);

  const inspect = trpc.archive.inspect.useMutation({
    onSuccess: result => {
      setSourceUrl(result.sourceUrl);
      setImages(result.images);
      setSelectedIds(result.images.filter(image => image.originalUrl).map(image => image.id));
      setJobId(null);
      toast.success(`${result.images.length} entrées analysées`, { description: "Les images originales détectées sont présélectionnées." });
    },
    onError: error => toast.error("Analyse impossible", { description: error.message }),
  });

  const status = trpc.archive.status.useQuery(
    { jobId: jobId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(jobId), refetchInterval: query => {
      const job = query.state.data;
      return job && ["complete", "failed"].includes(job.status) ? false : 900;
    } },
  );

  const build = trpc.archive.build.useMutation({
    onSettled: () => setIsBuilding(false),
    onError: error => toast.error("Archive interrompue", { description: error.message }),
  });

  const prepare = trpc.archive.prepare.useMutation({
    onSuccess: ({ jobId: nextJobId }) => {
      setJobId(nextJobId);
      setIsBuilding(true);
      build.mutate({ jobId: nextJobId });
    },
    onError: error => toast.error("Préparation impossible", { description: error.message }),
  });

  useEffect(() => {
    if (status.data?.status === "complete") {
      setIsBuilding(false);
      toast.success("Votre archive est prête", { description: `${status.data.completedCount} image(s) ajoutée(s) à l’archive.` });
    }
    if (status.data?.status === "failed") setIsBuilding(false);
  }, [status.data?.status]);

  const selectableImages = useMemo(() => images.filter(image => image.originalUrl), [images]);
  const currentJob = status.data;
  const completedCount = currentJob?.completedCount ?? 0;
  const progress = currentJob ? Math.round((completedCount / Math.max(currentJob.totalCount, 1)) * 100) : 0;
  const statusLabel = currentJob?.status === "queued" ? "Préparation…" : currentJob?.status === "downloading" ? "Téléchargement des originaux…" : currentJob?.status === "archiving" ? "Compression de l’archive…" : currentJob?.status === "complete" ? "Archive prête" : currentJob?.status === "failed" ? "Extraction interrompue" : "En attente d’une galerie";

  function toggleImage(id: string, checked: boolean) {
    setSelectedIds(current => checked ? [...current, id] : current.filter(value => value !== id));
  }

  function analyzeGallery() {
    const trimmed = galleryUrl.trim();
    if (!trimmed) {
      toast.error("Ajoutez l’URL de votre galerie avant de lancer l’analyse.");
      return;
    }
    inspect.mutate({ url: trimmed });
  }

  function createArchive() {
    const selected = images.filter(image => selectedIds.includes(image.id) && image.originalUrl);
    if (!selected.length) {
      toast.error("Aucune image originale n’est sélectionnée.");
      return;
    }
    prepare.mutate({ sourceUrl, images: selected });
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#f5f3ee] text-[#1d2a26]">
      <div className="absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_10%_15%,rgba(221,179,108,.22),transparent_31%),radial-gradient(circle_at_92%_7%,rgba(59,108,91,.17),transparent_28%)]" />
      <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-7 md:px-10">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1d4037] text-[#f7efe0] shadow-[0_8px_20px_rgba(29,64,55,.18)]"><Archive size={19} strokeWidth={1.8} /></div>
          <div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#507369]">atelier archive</p><p className="font-serif text-xl leading-none">Galerie originale</p></div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-[#1d4037]/10 bg-white/50 px-4 py-2 text-xs text-[#48655b] backdrop-blur-sm sm:flex"><LockKeyhole size={13} /> Traitement côté serveur</div>
      </header>

      <main className="relative mx-auto w-full max-w-7xl px-5 pb-20 pt-10 md:px-10 md:pt-16">
        <section className="grid items-end gap-12 lg:grid-cols-[1.08fr_.92fr]">
          <div className="max-w-2xl">
            <div className="mb-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.18em] text-[#bc7c39]"><span className="h-px w-7 bg-current" /> archiveur de galeries</div>
            <h1 className="font-serif text-5xl leading-[.98] tracking-[-.045em] text-[#183c32] sm:text-6xl md:text-7xl">Vos images,<br /><em className="font-serif text-[#b96d35]">sans les miniatures.</em></h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-[#52665f] md:text-lg">Analysez une galerie autorisée, contrôlez les images détectées et obtenez une archive ZIP des versions originales, sans manipulation de code.</p>
          </div>
          <div className="relative rounded-[2rem] border border-[#d9d5c9] bg-[#fbfaf6]/80 p-6 shadow-[0_22px_50px_rgba(34,50,44,.09)] backdrop-blur-sm md:p-8">
            <div className="mb-5 flex items-center justify-between"><p className="font-mono text-[11px] uppercase tracking-[.16em] text-[#52665f]">01 — Source</p><ScanSearch size={18} className="text-[#b96d35]" /></div>
            <label className="sr-only" htmlFor="gallery-url">URL de la page de galerie</label>
            <div className="rounded-2xl border border-[#d8d4c8] bg-white p-1.5 shadow-inner shadow-[#ede9de] focus-within:border-[#7e9b8d] focus-within:ring-4 focus-within:ring-[#8aaa9b]/15">
              <Input id="gallery-url" value={galleryUrl} onChange={event => setGalleryUrl(event.target.value)} onKeyDown={event => { if (event.key === "Enter") analyzeGallery(); }} placeholder="https://exemple.com/galerie" className="h-12 border-0 bg-transparent px-3 text-sm shadow-none placeholder:text-[#9ba39d] focus-visible:ring-0" />
            </div>
            <Button onClick={analyzeGallery} disabled={inspect.isPending || isBuilding} className="mt-4 h-12 w-full rounded-xl bg-[#1d4037] text-sm font-medium text-[#f9f5ec] transition-all hover:bg-[#285646] active:scale-[.98]">
              {inspect.isPending ? <><Loader2 className="animate-spin" /> Analyse de la page…</> : <>Analyser la galerie <ArrowRight size={17} /></>}
            </Button>
            <p className="mt-4 text-center text-xs leading-5 text-[#7c8781]">Utilisez uniquement des galeries auxquelles vous êtes autorisé à accéder.</p>
          </div>
        </section>

        {images.length > 0 && <section className="mt-16 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="overflow-hidden rounded-[2rem] border border-[#ddd8cd] bg-[#fdfcf9] shadow-[0_14px_40px_rgba(34,50,44,.06)]">
            <div className="flex flex-col justify-between gap-4 border-b border-[#e6e1d7] px-6 py-6 sm:flex-row sm:items-center md:px-8">
              <div><p className="font-mono text-[11px] uppercase tracking-[.16em] text-[#b96d35]">02 — Sélection</p><h2 className="mt-1 font-serif text-2xl tracking-[-.03em]">Images détectées</h2></div>
              <div className="rounded-full bg-[#e9f0eb] px-3 py-1.5 text-xs font-medium text-[#285646]">{selectedIds.length} sur {selectableImages.length} originale(s)</div>
            </div>
            <div className="divide-y divide-[#ece8df]">
              {images.map((image, index) => {
                const selected = selectedIds.includes(image.id);
                const available = Boolean(image.originalUrl);
                return <label key={image.id} className={`group flex cursor-pointer items-center gap-4 px-6 py-4 transition-colors hover:bg-[#faf8f2] md:px-8 ${!available ? "cursor-not-allowed opacity-60" : ""}`}>
                  <Checkbox checked={selected} disabled={!available || isBuilding} onCheckedChange={checked => toggleImage(image.id, checked === true)} className="h-5 w-5 rounded-md border-[#bfc8c0] data-[state=checked]:border-[#1d4037] data-[state=checked]:bg-[#1d4037]" />
                  <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#e8e5dc] text-[#769084]">{image.previewUrl ? <img src={image.previewUrl} alt="" className="h-full w-full object-cover" /> : <ImageOff size={16} />}</div>
                  <div className="min-w-0 flex-1"><p className="truncate font-mono text-xs text-[#263d35]">#{image.id}</p><p className="mt-0.5 truncate text-xs text-[#7b8881]">{image.resolutionNote || "Analyse terminée"}</p></div>
                  <div className={`hidden shrink-0 items-center gap-1.5 text-xs sm:flex ${available ? "text-[#477264]" : "text-[#9b7562]"}`}>{available ? <><Check size={14} /> Original</> : <><CircleAlert size={14} /> Indisponible</>}</div>
                  <span className="font-mono text-[10px] text-[#a2aaa4]">{String(index + 1).padStart(2, "0")}</span>
                </label>;
              })}
            </div>
          </div>

          <aside className="h-fit rounded-[2rem] bg-[#183c32] p-6 text-[#f8f2e6] shadow-[0_18px_45px_rgba(24,60,50,.17)] md:p-7">
            <div className="flex items-center justify-between"><p className="font-mono text-[11px] uppercase tracking-[.16em] text-[#c9ae7d]">03 — Archive</p><FileArchive size={19} className="text-[#c9ae7d]" /></div>
            <p className="mt-5 font-serif text-2xl leading-tight">Une archive prête à emporter.</p>
            <div className="mt-6 rounded-2xl bg-white/10 p-4">
              <div className="flex justify-between text-xs text-[#d8e4dd]"><span>{statusLabel}</span><span>{currentJob ? `${progress}%` : "—"}</span></div>
              <Progress value={progress} className="mt-3 h-1.5 bg-white/15 [&>div]:bg-[#dca762]" />
              <p className="mt-3 min-h-5 text-xs leading-5 text-[#b7c7bf]">{currentJob ? `${completedCount}/${currentJob.totalCount} image(s) traitée(s) · ${currentJob.failedCount} échec(s)` : "Sélectionnez les originaux avant de générer l’archive."}</p>
            </div>
            {currentJob?.status === "failed" && <p className="mt-4 rounded-xl border border-[#f0b37c]/30 bg-[#b96d35]/15 p-3 text-xs leading-5 text-[#fee5cc]">{currentJob.errorMessage || "L’extraction n’a pas pu être terminée."}</p>}
            {currentJob?.archiveUrl && <a href={currentJob.archiveUrl} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#d9a55f] text-sm font-semibold text-[#183c32] transition hover:bg-[#e6b66f] active:scale-[.98]"><Archive size={17} /> Télécharger le ZIP</a>}
            {!currentJob?.archiveUrl && <Button onClick={createArchive} disabled={prepare.isPending || isBuilding || selectedIds.length === 0} className="mt-5 h-12 w-full rounded-xl bg-[#f8f2e6] text-sm font-semibold text-[#183c32] transition hover:bg-white active:scale-[.98]">{prepare.isPending || isBuilding ? <><Loader2 className="animate-spin" /> Traitement en cours</> : <><Sparkles size={16} /> Créer l’archive ZIP</>}</Button>}
            <p className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-5 text-[#a9bdb4]">Jusqu’à 30 images et 80 Mo d’originaux par archive. Les liens inaccessibles sont signalés sans bloquer le reste du lot.</p>
          </aside>
        </section>}

        {!images.length && !inspect.isPending && <section className="mt-16 grid gap-5 border-t border-[#d9d5c9] pt-8 md:grid-cols-3 md:gap-8">
          {[{ n: "01", title: "Inspecter", text: "La page est récupérée de manière contrôlée, sans contrainte CORS dans votre navigateur." }, { n: "02", title: "Choisir", text: "Les balises de galerie sont lues et les liens d’originaux sont proposés pour validation." }, { n: "03", title: "Archiver", text: "Les fichiers disponibles sont récupérés en parallèle puis regroupés dans un ZIP." }].map(step => <div key={step.n} className="flex gap-4"><span className="font-mono text-xs text-[#b96d35]">{step.n}</span><div><h2 className="font-serif text-xl">{step.title}</h2><p className="mt-1 text-sm leading-6 text-[#68766f]">{step.text}</p></div></div>)}
        </section>}

        <section className="mt-16 rounded-[1.75rem] border border-[#dcd6c8] bg-[#ebe8de]/70 px-6 py-5 text-sm leading-6 text-[#68766f] md:px-8"><div className="flex gap-3"><Info size={18} className="mt-1 shrink-0 text-[#b96d35]" /><p><strong className="font-medium text-[#3f554c]">Respect des droits.</strong> Cet outil est prévu pour vos propres galeries, ou celles pour lesquelles vous disposez d’une autorisation explicite. Il refuse les adresses privées, applique des délais d’attente et limite le volume des archives afin de préserver le service.</p></div></section>
      </main>
      <footer className="relative border-t border-[#ddd8cd] px-5 py-7 text-center font-mono text-[10px] uppercase tracking-[.16em] text-[#8a958e]">Galerie originale · export ZIP contrôlé</footer>
    </div>
  );
}
