import Image from "next/image";

export function BrandMark({
  width = 40,
  height = 29,
  onDarkBackground = false,
  className,
}: {
  width?: number;
  height?: number;
  onDarkBackground?: boolean;
  className?: string;
}) {
  return (
    <Image
      className={className}
      src={onDarkBackground ? "/brand/logo-for-dark-background.svg" : "/brand/logo-horizontal-header.svg"}
      alt=""
      aria-hidden="true"
      width={width}
      height={height}
      unoptimized
    />
  );
}