import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

import { supabase } from "@/integrations/supabase/client";

supabase.auth.getSession().then(({ data }) => {
  console.log("INITIAL SESSION:", data.session);
});

supabase.auth.onAuthStateChange((event, session) => {
  console.log("AUTH EVENT:", event);
  console.log("SESSION:", session);
});

createRoot(document.getElementById("root")!).render(
  <App />
);