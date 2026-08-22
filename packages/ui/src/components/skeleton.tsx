export interface SkeletonProps {
  height?: string | number;
  width?: string | number;
}

export function Skeleton({ height, width }: SkeletonProps) {
  return <div className="ui-skeleton" style={{ height, width }} />;
}
