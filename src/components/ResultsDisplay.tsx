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
          <CardTitle className="flex items-center space-x-2">
            <DollarSign className="h-5 w-5 text-green-600" />
            <span>Analyzing...</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="animate-pulse space-y-3">
              <div className="h-12 bg-gray-200 rounded-lg"></div>
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-gray-100 rounded-lg"></div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-white/20 sticky top-24">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <DollarSign className="h-5 w-5 text-green-600" />
          <span>Estimated Value</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasResults ? (
          <div className="text-center py-8 space-y-4">
            <div className="w-16 h-16 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
              <DollarSign className="h-8 w-8 text-gray-400" />
            </div>
            <div>
              <p className="text-gray-500 font-medium">No results yet</p>
              <p className="text-sm text-gray-400 mt-1">
                Upload an image or describe your card to get started
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Warnings */}
            {warnings && warnings.length > 0 && (
              <Alert