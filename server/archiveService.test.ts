import { describe, expect, it } from "vitest";
import { deduplicateOriginalUrls, deriveOriginalFromThumbnail, parseGalleryAnchors, selectBestOriginalCandidate, validateRemoteUrl } from "./archiveService";

describe("parseGalleryAnchors", () => {
  it("extrait les identifiants des liens de galerie et résout les chemins relatifs", () => {
    const html = `
      <a name="1934186793" href="/photo/1934186793/?gid=7707771"><img src="https://cdn.example.com/images/thumb/49/193/1934186793.jpg" /></a>
      <a name="1934186794" href="/photo/1934186794/?gid=7707771"></a>
      <a name="sans-id" href="/photo/1"></a>
    `;
    expect(parseGalleryAnchors(html, "https://galerie.example.com/show/page")).toEqual([
      {
        id: "1934186793",
        detailUrl: "https://galerie.example.com/photo/1934186793/?gid=7707771",
        previewUrl: "https://cdn.example.com/images/thumb/49/193/1934186793.jpg",
      },
      {
        id: "1934186794",
        detailUrl: "https://galerie.example.com/photo/1934186794/?gid=7707771",
        previewUrl: undefined,
      },
    ]);
  });
});

describe("deriveOriginalFromThumbnail", () => {
  it("retire uniquement le segment de miniature du chemin CDN", () => {
    expect(deriveOriginalFromThumbnail("https://cdn.example.com/images/thumb/49/193/photo.jpg?secure=1")).toBe("https://cdn.example.com/images/49/193/photo.jpg?secure=1");
    expect(deriveOriginalFromThumbnail("https://cdn.example.com/images/photo.jpg")).toBeUndefined();
  });
});

describe("sélection et déduplication des originaux", () => {
  it("ignore les miniatures quand une page de détail propose aussi l’original", () => {
    expect(selectBestOriginalCandidate([
      "https://cdn.example.com/images/thumb/49/193/1934186793.jpg",
      "https://cdn.example.com/images/49/193/1934186793.jpg",
    ])).toBe("https://cdn.example.com/images/49/193/1934186793.jpg");
  });

  it("conserve la première URL originale et écarte toutes ses répétitions", () => {
    const images = deduplicateOriginalUrls([
      { originalUrl: "https://cdn.example.com/images/a.jpg", resolutionNote: "Original détecté" },
      { originalUrl: "https://cdn.example.com/images/a.jpg#fragment", resolutionNote: "Original détecté" },
      { originalUrl: "https://cdn.example.com/images/b.jpg", resolutionNote: "Original détecté" },
    ]);
    expect(images.map(image => image.originalUrl)).toEqual([
      "https://cdn.example.com/images/a.jpg",
      undefined,
      "https://cdn.example.com/images/b.jpg",
    ]);
  });
});

describe("validateRemoteUrl", () => {
  it("refuse les protocoles non web et les adresses locales avant tout appel distant", async () => {
    await expect(validateRemoteUrl("file:///etc/passwd")).rejects.toMatchObject({ code: "BAD_URL" });
    await expect(validateRemoteUrl("http://localhost/private-gallery")).rejects.toMatchObject({ code: "BAD_URL" });
  });
});
