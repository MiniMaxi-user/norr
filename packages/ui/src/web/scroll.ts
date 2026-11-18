// Scroll-position rules of the detail page (01 section 5): choosing another
// tab sends the centre back to the top while the rail keeps its position.

/** The centre scroll area of the current detail page (or the shell content
 * area on pages without a rail). */
export function getMainScrollArea(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("[data-web-main]") ??
    document.querySelector<HTMLElement>(".web-shell .ui-app-layout-content")
  );
}

/** After the next paint, so the new tab's content has replaced the old one. */
export function scrollMainToTop() {
  requestAnimationFrame(() => getMainScrollArea()?.scrollTo({ top: 0 }));
}
