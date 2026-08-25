import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import {
  EVENT_COMPANY_EXPLORER_FIND_REQUESTED,
  EVENT_HUDDLE_EXPLORER_FIND_REQUESTED,
} from "../dashboardEvents.js";

export function useExplorerSearchQuery(companyID: string): [string, Dispatch<SetStateAction<string>>] {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const clearMatchingSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      if (detail?.companyID?.trim() === companyID.trim()) setQuery("");
    };
    window.addEventListener(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, clearMatchingSearch);
    window.addEventListener(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, clearMatchingSearch);
    return () => {
      window.removeEventListener(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, clearMatchingSearch);
      window.removeEventListener(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, clearMatchingSearch);
    };
  }, [companyID]);

  return [query, setQuery];
}
