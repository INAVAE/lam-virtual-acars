import { useId, useMemo } from 'react';
import { renderBadgeSvg, type BadgeSpec } from '@/lib/badge-art';
import { cn } from '@/lib/cn';

/** Insignia de LAM dibujada en SVG (oro, plata o bronce). */
export function BadgeArt({ spec, size = 96, className, title }: { spec: BadgeSpec; size?: number; className?: string; title?: string }) {
  const uid = `ba${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const svg = useMemo(() => renderBadgeSvg(spec, uid, size), [spec, uid, size]);
  return (
    <span
      role="img"
      aria-label={title ?? 'Insignia'}
      title={title}
      className={cn('inline-block shrink-0 align-middle [&>svg]:block [&>svg]:size-full', className)}
      style={{ width: size, height: size }}
      // El SVG lo genera renderBadgeSvg: los textos se escapan.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Prefijo de los archivos generados con la biblioteca (el tour los muestra sin recorte circular). */
export const BADGE_ART_PREFIX = 'lam-badge';

/**
 * Convierte la insignia a PNG con fondo transparente (para subirla como la
 * insignia de un tour o descargarla). Si pasa de 480 KB, a WebP.
 */
export async function badgePngFile(spec: BadgeSpec, name: string, size = 512): Promise<File> {
  const svg = renderBadgeSvg(spec, 'export', size);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo dibujar la insignia'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite dibujar la insignia');
    ctx.drawImage(img, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('No se pudo crear la imagen');
    if (blob.size > 480 * 1024) {
      const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
      if (webp && webp.type === 'image/webp') return new File([webp], `${BADGE_ART_PREFIX}-${name}.webp`, { type: 'image/webp' });
    }
    return new File([blob], `${BADGE_ART_PREFIX}-${name}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Descarga un archivo desde el navegador. */
export function downloadFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
