import { describe, expect, it } from "vitest";
import { UNVERIFIED } from "@/server/adapters/text-model";
import { decodeEntities, textKey, toWordPressHtml } from "@/server/wordpress/html";

describe("toWordPressHtml", () => {
  it("chapô en gras, paragraphes, retours simples et texte échappé", () => {
    const html = toWordPressHtml(
      "Verkor lève 2 Md€ <script>alert(1)</script>",
      'Premier paragraphe "cité" & l\'usine.\nSuite du paragraphe.\n\n\nSecond <b>paragraphe</b>.',
    );
    expect(html).toBe(
      [
        "<p><strong>Verkor lève 2 Md€ &lt;script&gt;alert(1)&lt;/script&gt;</strong></p>",
        "<p>Premier paragraphe &quot;cité&quot; &amp; l&#39;usine.<br>Suite du paragraphe.</p>",
        "<p>Second &lt;b&gt;paragraphe&lt;/b&gt;.</p>",
      ].join("\n"),
    );
    expect(html).not.toMatch(/<script|<b>/);
  });

  it("lignes « - » consécutives en liste, même séparées par une ligne vide", () => {
    const html = toWordPressHtml(
      "",
      "Les chiffres :\n- 2 000 emplois\n\n- 16 GWh\n-\n- \nUne baisse de -5 % n'est pas une liste.",
    );
    expect(html).toBe(
      [
        "<p>Les chiffres :</p>",
        "<ul><li>2 000 emplois</li><li>16 GWh</li></ul>",
        "<p>-<br>Une baisse de -5 % n&#39;est pas une liste.</p>",
      ].join("\n"),
    );
  });

  it("URL cliquables, href échappé, ponctuation finale et parenthèse non ouverte exclues", () => {
    const html = toWordPressHtml(
      "",
      'Source : https://exemple.fr/a?x=1&y="2". (voir https://exemple.fr/wiki/Grenoble_(Isère)), puis https://exemple.fr/b).',
    );
    expect(html).toContain(
      '<a href="https://exemple.fr/a?x=1&amp;y=">https://exemple.fr/a?x=1&amp;y=</a>&quot;2&quot;.',
    );
    expect(html).toContain(
      '<a href="https://exemple.fr/wiki/Grenoble_(Isère)">https://exemple.fr/wiki/Grenoble_(Isère)</a>),',
    );
    expect(html).toContain('<a href="https://exemple.fr/b">https://exemple.fr/b</a>).');
    expect(html).not.toContain("javascript:");
  });

  it("n'accepte que http(s) : pas de lien javascript: ni data:", () => {
    const html = toWordPressHtml("", "javascript:alert(1) data:text/html,<b>x</b> http://.");
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;b&gt;");
  });

  it("garde les marqueurs « À vérifier » visibles et surlignés", () => {
    const html = toWordPressHtml(`Chapô ${UNVERIFIED}`, `- Chiffre ${UNVERIFIED}\n\nFin.`);
    expect(html).toBe(
      [
        `<p><strong>Chapô <mark>${UNVERIFIED}</mark></strong></p>`,
        `<ul><li>Chiffre <mark>${UNVERIFIED}</mark></li></ul>`,
        "<p>Fin.</p>",
      ].join("\n"),
    );
  });

  it("normalise les fins de ligne Windows et ignore les blocs vides", () => {
    expect(toWordPressHtml("  ", "Un\r\nDeux\r\n\r\n   \r\n\r\nTrois")).toBe(
      "<p>Un<br>Deux</p>\n<p>Trois</p>",
    );
  });
});

describe("entités HTML renvoyées par WordPress", () => {
  it("décode les entités nommées, décimales et hexadécimales", () => {
    expect(
      decodeEntities("R&amp;D &#8217; &#x2019; &eacute;t&eacute; &hellip; &inconnue; &#0;"),
    ).toBe("R&D ’ ’ été … &inconnue; &#0;");
  });

  it("compare sans tenir compte des entités, de la casse ni des espaces", () => {
    expect(textKey("Distinction &amp; Prix")).toBe(textKey("  distinction   &  prix "));
    expect(textKey("Levée")).toBe(textKey("Lev\u0065\u0301e"));
  });
});
