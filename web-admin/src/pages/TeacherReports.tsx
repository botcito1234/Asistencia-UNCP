import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card, ErrorMessage } from '../components/ui';
import { fechaHora } from '../lib/format';

type Report = {
  id: string;
  nature: string;
  importance: string;
  detail: string;
  recommendation: string | null;
  createdAt: string;
  intern: { firstNames: string; lastNames: string };
  conductor: { user: { displayName: string } };
};

export function TeacherReports() {
  const reports = useQuery({
    queryKey: ['seguimiento-docente'],
    queryFn: () => api.get<{ items: Report[] }>('/operacion/seguimiento-docente'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Seguimiento docente</h1>
        <p className="mt-1 text-sm text-slate-500">Reportes privados para administración.</p>
      </div>

      {reports.isError ? <ErrorMessage error={reports.error} onRetry={() => void reports.refetch()} /> : (
        <div className="grid gap-4">
          {(reports.data?.items ?? []).map((report) => (
            <Card key={report.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-slate-900">{report.intern.lastNames}, {report.intern.firstNames}</h2>
                  <p className="text-xs text-slate-500">{report.conductor.user.displayName} · {fechaHora(report.createdAt)}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{report.importance} · {report.nature}</span>
              </div>
              <p className="mt-3 text-sm text-slate-700">{report.detail}</p>
              {report.recommendation && <p className="mt-2 text-sm text-slate-500">Recomendación: {report.recommendation}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
