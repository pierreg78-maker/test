import * as cheerio from "cheerio";
import { lookup } from "node:dns/promises";
import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import { and, asc, eq } from "drizzle-orm";
import { archiveJobImages, archiveJobs } from "../drizzle/schema";
import { getDb } from "./db";
import { storagePut } from "./storage";

const MAX_GALLERY_IMAGES = 30;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ARCHIVE_INPUT_BYTES = 80 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const HTML_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;

export type GalleryImage = {
  id: string;
  detailUrl: string;
  previewUrl?: string;
  originalUrl?: string;
  resolutionNote?: string;
};

type PreparedImage = Pick<GalleryImage, "id" | "detailUrl" | "previewUrl" | "originalUrl">;

type ArchiveFile = {
  id: string;
  originalUrl: string;
  fileName: string;
};

export class ArchiveServiceError extends Error {
  constructor(message: string, public readonly code: "BAD_URL" | "UNREACHABLE" | "LIMIT" | "INVALID_SOURCE") {
    super(message);
  }
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export async function validateRemoteUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new ArchiveServiceError("Saisissez une URL complète et valide (https://…).", "BAD_URL");
  }

  if (!(url.protocol === "https:" || url.protocol === "http:") || url.username || url.password) {
    throw new ArchiveServiceError("Seules les URL HTTP(S) publiques, sans identifiants, sont acceptées.", "BAD_URL");
  }
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new ArchiveServiceError("Cette adresse n’est pas accessible par le service.", "BAD_URL");
  }

  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new ArchiveServiceError("L’adresse doit pointer vers un site internet public.", "BAD_URL");
    }
  } catch (error) {
    if (error instanceof ArchiveServiceError) throw error;
    throw new ArchiveServiceError("Impossible de résoudre le domaine indiqué. Vérifiez l’adresse et réessayez.", "BAD_URL");
  }

  return url;
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const length = Number(response.headers.get("content-length") || 0);
  if (length && length > maxBytes) throw new ArchiveServiceError("Le fichier dépasse la taille maximale autorisée.", "LIMIT");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ArchiveServiceError("Le fichier dépasse la taille maximale autorisée.", "LIMIT");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function safeFetch(rawUrl: string, maxBytes: number, timeoutMs: number): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = await validateRemoteUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "OriginalImageArchive/1.0 (authorized gallery download)" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new ArchiveServiceError("Une redirection invalide a été rencontrée.", "UNREACHABLE");
        currentUrl = await validateRemoteUrl(new URL(location, currentUrl).toString());
        continue;
      }
      if (!response.ok) throw new ArchiveServiceError(`La ressource distante a répondu avec le statut ${response.status}.`, "UNREACHABLE");
      const size = Number(response.headers.get("content-length") || 0);
      if (size && size > maxBytes) throw new ArchiveServiceError("La ressource distante dépasse la taille maximale autorisée.", "LIMIT");
      return { response, finalUrl: currentUrl };
    } catch (error) {
      if (error instanceof ArchiveServiceError) throw error;
      if ((error as Error).name === "AbortError") throw new ArchiveServiceError("Le serveur distant a mis trop de temps à répondre.", "UNREACHABLE");
      throw new ArchiveServiceError("Impossible de récupérer la ressource distante.", "UNREACHABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new ArchiveServiceError("Trop de redirections ont été rencontrées.", "UNREACHABLE");
}

async function fetchHtml(rawUrl: string) {
  const { response, finalUrl } = await safeFetch(rawUrl, MAX_HTML_BYTES, HTML_TIMEOUT_MS);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new ArchiveServiceError("L’URL ne semble pas mener à une page de galerie HTML.", "INVALID_SOURCE");
  }
  return { html: (await readLimited(response, MAX_HTML_BYTES)).toString("utf8"), finalUrl };
}

function toAbsoluteUrl(value: string | undefined, base: URL) {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function imageExtension(url: string, contentType: string) {
  const match = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
  if (match && /^(jpe?g|png|webp|gif|avif)$/i.test(match[1])) return match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

function looksLikeImage(value: string | undefined) {
  return Boolean(value && /\.(?:jpe?g|png|webp|gif|avif)(?:[?#].*)?$/i.test(value));
}

function rankImageCandidate(candidate: string) {
  const lowered = candidate.toLowerCase();
  let score = 0;
  if (!lowered.includes("thumb")) score += 8;
  if (lowered.includes("original") || lowered.includes("full") || lowered.includes("large") || lowered.includes("zoom")) score += 5;
  if (lowered.includes("/images/")) score += 2;
  return score;
}

export function selectBestOriginalCandidate(candidates: string[], previewUrl?: string) {
  const onlyOriginals = candidates.filter(candidate => !candidate.toLowerCase().includes("/images/thumb/"));
  return onlyOriginals.sort((a, b) => rankImageCandidate(b) - rankImageCandidate(a))[0] || deriveOriginalFromThumbnail(previewUrl);
}

export function deduplicateOriginalUrls<T extends { originalUrl?: string; resolutionNote?: string }>(images: T[]) {
  const firstByUrl = new Map<string, number>();
  return images.map((image, index) => {
    if (!image.originalUrl) return image;
    const normalized = image.originalUrl.split("#", 1)[0];
    const firstIndex = firstByUrl.get(normalized);
    if (firstIndex === undefined) {
      firstByUrl.set(normalized, index);
      return image;
    }
    return {
      ...image,
      originalUrl: undefined,
      resolutionNote: `Doublon de l’image ${String(firstIndex + 1).padStart(2, "0")} écarté automatiquement`,
    };
  });
}

function uniqueFileName(baseName: string, usedNames: Set<string>) {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }
  const lastDot = baseName.lastIndexOf(".");
  const stem = lastDot > 0 ? baseName.slice(0, lastDot) : baseName;
  const extension = lastDot > 0 ? baseName.slice(lastDot) : "";
  let suffix = 2;
  while (usedNames.has(`${stem}-${suffix}${extension}`)) suffix += 1;
  const name = `${stem}-${suffix}${extension}`;
  usedNames.add(name);
  return name;
}

export function parseGalleryAnchors(html: string, galleryUrl: string) {
  const $ = cheerio.load(html);
  const base = new URL(galleryUrl);
  const seen = new Set<string>();
  const entries: Array<Omit<GalleryImage, "originalUrl" | "resolutionNote">> = [];
  $("a[name]").each((_, anchor) => {
    const id = ($(anchor).attr("name") || "").trim();
    const href = $(anchor).attr("href");
    if (!/^\d{4,24}$/.test(id) || !href || seen.has(id)) return;
    const detailUrl = toAbsoluteUrl(href, base);
    if (!detailUrl) return;
    const localImage = $(anchor).find("img").first().attr("src") || $("img").filter((_, image) => ($(image).attr("src") || "").includes(id)).first().attr("src");
    entries.push({ id, detailUrl, previewUrl: toAbsoluteUrl(localImage, base) });
    seen.add(id);
  });
  return entries;
}

export function deriveOriginalFromThumbnail(previewUrl?: string) {
  if (!previewUrl) return undefined;
  try {
    const candidate = new URL(previewUrl);
    candidate.pathname = candidate.pathname.replace(/\/images\/thumb\//i, "/images/");
    if (candidate.pathname === new URL(previewUrl).pathname) return undefined;
    return candidate.toString();
  } catch {
    return undefined;
  }
}

async function resolveOriginalUrl(image: Omit<GalleryImage, "originalUrl" | "resolutionNote">): Promise<GalleryImage> {
  try {
    const { html, finalUrl } = await fetchHtml(image.detailUrl);
    const $ = cheerio.load(html);
    const candidates = new Set<string>();
    $("meta[property='og:image'], meta[name='og:image'], meta[name='twitter:image'], link[rel='image_src']").each((_, element) => {
      const candidate = toAbsoluteUrl($(element).attr("content") || $(element).attr("href"), finalUrl);
      if (candidate) candidates.add(candidate);
    });
    $("img[src], img[data-src], a[href]").each((_, element) => {
      const raw = $(element).attr("src") || $(element).attr("data-src") || $(element).attr("href");
      if (!looksLikeImage(raw)) return;
      const candidate = toAbsoluteUrl(raw, finalUrl);
      if (candidate) candidates.add(candidate);
    });
    const resolved = selectBestOriginalCandidate(Array.from(candidates), image.previewUrl);
    return resolved
      ? { ...image, originalUrl: resolved, resolutionNote: "Image originale détectée" }
      : { ...image, resolutionNote: "Aucune image téléchargeable n’a été trouvée pour cette entrée" };
  } catch (error) {
    return { ...image, resolutionNote: error instanceof Error ? error.message : "Impossible d’analyser cette image" };
  }
}

async function mapWithConcurrency<T, U>(items: T[], limit: number, callback: (item: T) => Promise<U>) {
  const results = new Array<U>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await callback(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function inspectGallery(rawUrl: string) {
  const { html, finalUrl } = await fetchHtml(rawUrl);
  const anchors = parseGalleryAnchors(html, finalUrl.toString());
  if (!anchors.length) {
    throw new ArchiveServiceError("Aucune balise d’image de type a[name='…'] n’a été trouvée sur cette page.", "INVALID_SOURCE");
  }
  if (anchors.length > MAX_GALLERY_IMAGES) {
    throw new ArchiveServiceError(`Cette galerie contient ${anchors.length} images. La limite de cette version est de ${MAX_GALLERY_IMAGES} images par archive.`, "LIMIT");
  }
  const resolvedImages = await mapWithConcurrency(anchors, 4, resolveOriginalUrl);
  const images = deduplicateOriginalUrls(resolvedImages);
  return { sourceUrl: finalUrl.toString(), images };
}

function isJobStatus(value: string) {
  return ["queued", "downloading", "archiving", "complete", "failed"].includes(value);
}

async function getJob(jobId: string) {
  const db = await getDb();
  if (!db) throw new Error("La base de données est indisponible. Réessayez dans un instant.");
  const jobs = await db.select().from(archiveJobs).where(eq(archiveJobs.id, jobId)).limit(1);
  return { db, job: jobs[0] };
}

export async function prepareArchive(sourceUrl: string, selectedImages: PreparedImage[]) {
  const selectedUrlSet = new Set<string>();
  const validImages = selectedImages.filter(image => {
    if (!image.originalUrl || !/^\d{4,24}$/.test(image.id)) return false;
    const normalizedUrl = image.originalUrl.split("#", 1)[0];
    if (selectedUrlSet.has(normalizedUrl)) return false;
    selectedUrlSet.add(normalizedUrl);
    return true;
  });
  if (!validImages.length) throw new ArchiveServiceError("Sélectionnez au moins une image originale détectée.", "INVALID_SOURCE");
  if (validImages.length > MAX_GALLERY_IMAGES) throw new ArchiveServiceError(`Limite de ${MAX_GALLERY_IMAGES} images par archive atteinte.`, "LIMIT");
  await validateRemoteUrl(sourceUrl);
  await Promise.all(validImages.map(image => validateRemoteUrl(image.originalUrl!)));

  const db = await getDb();
  if (!db) throw new Error("La base de données est indisponible. Réessayez dans un instant.");
  const jobId = randomUUID();
  await db.insert(archiveJobs).values({ id: jobId, sourceUrl, status: "queued", totalCount: validImages.length, completedCount: 0, failedCount: 0 });
  await db.insert(archiveJobImages).values(validImages.map(image => ({
    jobId,
    imageId: image.id,
    originalUrl: image.originalUrl!,
    previewUrl: image.previewUrl ?? null,
    detailUrl: image.detailUrl,
    status: "queued" as const,
  })));
  return { jobId };
}

export async function getArchiveJobStatus(jobId: string) {
  const { db, job } = await getJob(jobId);
  if (!job) return null;
  const images = await db.select().from(archiveJobImages).where(eq(archiveJobImages.jobId, jobId)).orderBy(asc(archiveJobImages.id));
  return { ...job, images };
}

async function updateJobCounters(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, jobId: string) {
  const images = await db.select({ status: archiveJobImages.status }).from(archiveJobImages).where(eq(archiveJobImages.jobId, jobId));
  const completedCount = images.filter(image => image.status === "complete").length;
  const failedCount = images.filter(image => image.status === "failed").length;
  await db.update(archiveJobs).set({ completedCount, failedCount }).where(eq(archiveJobs.id, jobId));
}

export async function buildArchive(jobId: string) {
  const { db, job } = await getJob(jobId);
  if (!job) throw new ArchiveServiceError("Cette extraction n’existe pas ou a expiré.", "INVALID_SOURCE");
  if (job.status === "complete") return { jobId, status: "complete" as const };
  if (job.status !== "queued" && job.status !== "failed") return { jobId, status: job.status as "downloading" | "archiving" };

  const selectedImages = await db.select().from(archiveJobImages).where(and(eq(archiveJobImages.jobId, jobId), eq(archiveJobImages.status, "queued"))).orderBy(asc(archiveJobImages.id));
  if (!selectedImages.length) throw new ArchiveServiceError("Aucune image en attente n’est disponible pour cette archive.", "INVALID_SOURCE");

  await db.update(archiveJobs).set({ status: "downloading", errorMessage: null }).where(eq(archiveJobs.id, jobId));
  const zip = new JSZip();
  let accumulatedBytes = 0;
  const contentHashes = new Set<string>();
  const usedFileNames = new Set<string>();

  await mapWithConcurrency(selectedImages, 4, async image => {
    try {
      await db.update(archiveJobImages).set({ status: "downloading", errorMessage: null }).where(eq(archiveJobImages.id, image.id));
      const { response, finalUrl } = await safeFetch(image.originalUrl, MAX_IMAGE_BYTES, FETCH_TIMEOUT_MS);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) throw new ArchiveServiceError("La ressource détectée n’est pas une image téléchargeable.", "INVALID_SOURCE");
      const bytes = await readLimited(response, MAX_IMAGE_BYTES);
      accumulatedBytes += bytes.byteLength;
      if (accumulatedBytes > MAX_ARCHIVE_INPUT_BYTES) throw new ArchiveServiceError("La taille totale des images dépasse la limite de 80 Mo par archive.", "LIMIT");
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      if (contentHashes.has(contentHash)) {
        await db.update(archiveJobImages).set({ status: "complete", errorMessage: "Fichier identique à une image déjà ajoutée : doublon ignoré." }).where(eq(archiveJobImages.id, image.id));
        return;
      }
      contentHashes.add(contentHash);
      const fileName = uniqueFileName(`image-${image.imageId}.${imageExtension(finalUrl.toString(), contentType)}`, usedFileNames);
      zip.file(fileName, bytes, { binary: true });
      await db.update(archiveJobImages).set({ status: "complete", fileName, byteSize: bytes.byteLength }).where(eq(archiveJobImages.id, image.id));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Le téléchargement a échoué pour cette image.";
      await db.update(archiveJobImages).set({ status: "failed", errorMessage }).where(eq(archiveJobImages.id, image.id));
    } finally {
      await updateJobCounters(db, jobId);
    }
  });

  const completed = await db.select().from(archiveJobImages).where(and(eq(archiveJobImages.jobId, jobId), eq(archiveJobImages.status, "complete")));
  if (!completed.length) {
    await db.update(archiveJobs).set({ status: "failed", errorMessage: "Aucune image n’a pu être téléchargée. Vérifiez les droits d’accès et les liens de la galerie." }).where(eq(archiveJobs.id, jobId));
    return { jobId, status: "failed" as const };
  }

  await db.update(archiveJobs).set({ status: "archiving" }).where(eq(archiveJobs.id, jobId));
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const { url } = await storagePut(`archives/gallery-${jobId}.zip`, archive, "application/zip");
  await db.update(archiveJobs).set({ status: "complete", archiveUrl: url }).where(eq(archiveJobs.id, jobId));
  return { jobId, status: "complete" as const };
}

export const archiveLimits = { maxImages: MAX_GALLERY_IMAGES, maxArchiveBytes: MAX_ARCHIVE_INPUT_BYTES };
