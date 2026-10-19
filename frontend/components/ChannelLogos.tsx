import React from 'react';

/** Apretón de manos de Mercado Libre. El PNG ya tiene fondo transparente. */
export const MercadoLibreLogo: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <img
    src="/icons/mercado-libre.png"
    alt=""
    width={size}
    height={size}
    draggable={false}
    className={`shrink-0 object-contain pointer-events-none select-none ${className}`}
    style={{ width: size, height: size }}
  />
);

/** Anillos de Tienda Nube. Van sobre blanco porque la marca es azul oscuro. */
export const TiendaNubeLogo: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <span
    className={`inline-flex shrink-0 items-center justify-center rounded-[22%] bg-white ${className}`}
    style={{ width: size, height: size }}
  >
    <img
      src="/icons/tienda-nube.png"
      alt=""
      draggable={false}
      className="object-contain pointer-events-none select-none"
      style={{ width: Math.round(size * 0.84), height: Math.round(size * 0.84) }}
    />
  </span>
);

/** Logo del canal, si la vista es Mercado Libre o Tienda Nube. */
export function channelLogoForView(viewId: string, size: number): React.ReactNode | null {
  if (viewId === 'tiendanube_orders') return <TiendaNubeLogo size={size} />;
  if (viewId === 'mercadolibre_orders') return <MercadoLibreLogo size={size} />;
  return null;
}
