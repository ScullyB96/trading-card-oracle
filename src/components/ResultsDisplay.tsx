import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, DollarSign, Calendar, Building, AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface SalesResult {
  id: string;
  title: string;
  price: number;
  date: string;
  source: string;
  url: string;
  thumbnail?: string;
  selected: boolean;
  type?: string;
}

interface ResultsDisplayProps {
  results: SalesResult[];
  estimatedValue: number | null;
  onResultToggle: (id: string) => void;
  isLoading: boolean;
  logicUsed?: string;
  warnings?: string[];
}

const logicLabels: { [key: string]: string } = {
  lastSale: "Last Sale",
  average3: "Average of 3",
  average5: "Average of 5",
  median: "Median Price",
  conservative: "Conservative (25th percentile)",
  mode: "Most Common Range"
};

export const ResultsDisplay = ({ 
  results, 
  estimatedValue, 
  onResultToggle, 
  isLoading,
  logicUsed,
  warnings
}: ResultsDisplayProps) => {
  const selectedResults = results.filter(r => r.selected);
  const hasResults = results.length > 0;

  if (isLoading) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-white/20 sticky top-24">
        <CardHeader>
          <CardTitle className