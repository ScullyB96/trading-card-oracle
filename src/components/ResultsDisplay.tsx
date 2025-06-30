
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
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  <div className="space-y-1">
                    {warnings.map((warning, index) => (
                      <div key={index} className="text-sm">{warning}</div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Estimated Value */}
            <div className="text-center p-6 bg-gradient-to-r from-green-50 to-blue-50 rounded-xl border border-green-200">
              <div className="text-3xl font-bold text-green-700 mb-2">
                {estimatedValue ? `$${estimatedValue.toFixed(2)}` : 'N/A'}
              </div>
              <p className="text-sm text-gray-600 mb-1">
                Based on {selectedResults.length} selected sale{selectedResults.length !== 1 ? 's' : ''}
              </p>
              {logicUsed && (
                <div className="flex items-center justify-center space-x-1 text-xs text-blue-600">
                  <Info className="h-3 w-3" />
                  <span>Using {logicLabels[logicUsed] || logicUsed}</span>
                </div>
              )}
            </div>

            {/* Sales Results */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-gray-800">Recent Sales</h4>
                <Badge variant="outline" className="text-xs">
                  {results.length} found
                </Badge>
              </div>
              
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {results.map((result) => (
                  <div
                    key={result.id}
                    className={`p-4 rounded-lg border transition-all ${
                      result.selected 
                        ? 'border-blue-300 bg-blue-50' 
                        : 'border-gray-200 bg-white opacity-75'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <Checkbox
                        checked={result.selected}
                        onCheckedChange={() => onResultToggle(result.id)}
                        className="mt-1"
                      />
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-2">
                          <h5 className="text-sm font-medium text-gray-800 line-clamp-2">
                            {result.title}
                          </h5>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-2 h-6 w-6 p-0 text-gray-400 hover:text-blue-600"
                            asChild
                          >
                            <a href={result.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-lg font-bold text-green-600">
                              ${result.price.toFixed(2)}
                            </span>
                            <div className="flex items-center space-x-2">
                              {result.type && (
                                <Badge variant="outline" className="text-xs capitalize">
                                  {result.type}
                                </Badge>
                              )}
                              <Badge variant="secondary" className="text-xs">
                                {result.source}
                              </Badge>
                            </div>
                          </div>
                          
                          <div className="flex items-center space-x-3 text-xs text-gray-500">
                            <div className="flex items-center space-x-1">
                              <Calendar className="h-3 w-3" />
                              <span>{new Date(result.date).toLocaleDateString()}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Building className="h-3 w-3" />
                              <span>{result.source}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedResults.length === 0 && (
              <div className="text-center p-4 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-sm text-amber-600">
                  Select at least one sale to calculate estimated value
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
