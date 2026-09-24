import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Attendance } from './pages/Attendance';
import { AttendanceDetail } from './pages/AttendanceDetail';
import { Interns } from './pages/Interns';
import { InternDetail } from './pages/InternDetail';
import { Sites } from './pages/Sites';
import { SiteBoard } from './pages/SiteBoard';
import { Security } from './pages/Security';
import { Reports } from './pages/Reports';
import { Archive } from './pages/Archive';
import { Audit } from './pages/Audit';
import { Settings } from './pages/Settings';
import { CambiarPasswordObligatorio } from './pages/CambiarPasswordObligatorio';

/** Denegar por defecto: ninguna ruta del panel es accesible sin sesion. */
function Protegida({ children }: { children: ReactElement }) {
  const { user, cargando } = useAuth();
  const location = useLocation();

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-marca-600 border-r-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  if (user.role !== 'ADMINISTRADOR') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Acceso no permitido</h1>
          <p className="mt-2 text-sm text-slate-600">
            Este panel es exclusivo para administradores. Los practicantes registran su asistencia desde la aplicación
            móvil.
          </p>
        </div>
      </div>
    );
  }

  // La contrasena temporal debe reemplazarse antes de cualquier otra cosa.
  if (user.mustChangePassword) return <CambiarPasswordObligatorio />;

  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <Protegida>
            <Layout />
          </Protegida>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/asistencia" element={<Attendance />} />
        <Route path="/asistencia/:attendanceDayId" element={<AttendanceDetail />} />
        <Route path="/practicantes" element={<Interns />} />
        <Route path="/practicantes/:internId" element={<InternDetail />} />
        <Route path="/sedes" element={<Sites />} />
        <Route path="/sedes/:siteId" element={<SiteBoard />} />
        <Route path="/seguridad" element={<Security />} />
        <Route path="/reportes" element={<Reports />} />
        <Route path="/archivado" element={<Archive />} />
        <Route path="/auditoria" element={<Audit />} />
        <Route path="/parametros" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
