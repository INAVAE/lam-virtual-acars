import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { currentLocale } from '@/lib/i18n';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number | null;
  onPageChange: (page: number) => void;
}


export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <p>
        {new Intl.NumberFormat(currentLocale()).format(from)} a {new Intl.NumberFormat(currentLocale()).format(to)} de {new Intl.NumberFormat(currentLocale()).format(total)}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="size-4" aria-hidden />
          Anterior
        </Button>
        <span className="tabular-nums">
          {page + 1} / {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => onPageChange(page + 1)}>
          Siguiente
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
