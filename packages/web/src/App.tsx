import { Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GuildLayout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import LoginPage from "./pages/Login";
import GuildPickerPage from "./pages/GuildPicker";
import OverviewPage from "./pages/Overview";
import ModulePage from "./pages/ModulePage";
import KnowledgePage from "./pages/KnowledgePage";
import { AuditPage, CasesPage, MembersPage, TicketQueuePage } from "./pages/data-pages";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        // Never retry an auth or permission failure; it will not get better.
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

export const App = () => (
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/guilds" element={<GuildPickerPage />} />

        <Route path="/guilds/:guildId" element={<GuildLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="tickets-data" element={<TicketQueuePage />} />
          <Route path="cases" element={<CasesPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="audit" element={<AuditPage />} />
          {/* Every configurable module renders through one route. */}
          <Route path=":module" element={<ModulePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/guilds" replace />} />
      </Routes>
    </ToastProvider>
  </QueryClientProvider>
);

export default App;
