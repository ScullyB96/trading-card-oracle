
import { memo } from "react";
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

const ResultsDisplayComponent = ({
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
            <div className="animate-pulse">
              <div className="h-4 bg-gray-300 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-300 rounded w-1/2"></div>
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
        <div className="space-y-4">
          {estimatedValue !== null && (
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">
                ${estimatedValue.toLocaleString()}
              </div>
              {logicUsed && (
                <div className="text-sm text-gray-600 mt-1">
                  Based on: {logicLabels[logicUsed] || logicUsed}
                </div>
              )}
            </div>
          )}

          {warnings && warnings.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {warnings.map((warning, index) => (
                  <div key={index}>{warning}</div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {hasResults && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Sales Data ({selectedResults.length} of {results.length} selected)
                </span>
              </div>

              <div className="max-h-96 overflow-y-auto space-y-2">
                {results.map((result) => (
                  <div
                    key={result.id}
                    className={`p-3 border rounded-lg ${
                      result.selected ? 'bg-blue-50 border-blue-200' : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <Checkbox
                        checked={result.selected}
                        onCheckedChange={() => onResultToggle(result.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-gray-900 truncate">
                            {result.title}
                          </h4>
                          <div className="flex items-center space-x-2">
                            <span className="text-lg font-bold text-green-600">
                              ${result.price.toLocaleString()}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => window.open(result.url, '_blank')}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            <Building className="h-3 w-3 mr-1" />
                            {result.source}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            <Calendar className="h-3 w-3 mr-1" />
                            {result.date}
                          </Badge>
                          {result.type && (
                            <Badge variant="outline" className="text-xs">
                              {result.type}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasResults && !isLoading && (
            <div className="text-center py-8">
              <Info className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No sales data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export const ResultsDisplay = memo(ResultsDisplayComponent);
