
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock, Target, Database, Search, Zap } from "lucide-react";

interface EstimationSummaryProps {
  estimatedValue: number | null;
  confidence: number;
  methodology: string;
  logicUsed: string;
  exactMatchFound: boolean;
  matchMessage?: string;
  dataPoints: number;
  priceRange?: { low: number; high: number };
  productionResponse?: any;
}

const logicLabels: { [key: string]: string } = {
  lastSale: "Last Sale",
  average3: "Average of 3",
  average5: "Average of 5", 
  median: "Median Price",
  conservative: "Conservative (25th percentile)",
  mode: "Most Common Range"
};

export const EstimationSummary = ({
  estimatedValue,
  confidence,
  methodology,
  logicUsed,
  exactMatchFound,
  matchMessage,
  dataPoints,
  priceRange,
  productionResponse
}: EstimationSummaryProps) => {
  const getConfidenceColor = (conf: number) => {
    if (conf >= 0.8) return "text-green-600 bg-green-50 border-green-200";
    if (conf >= 0.6) return "text-yellow-600 bg-yellow-50 border-yellow-200";
    return "text-red-600 bg-red-50 border-red-200";
  };

  const getConfidenceLabel = (conf: number) => {
    if (conf >= 0.8) return "High Confidence";
    if (conf >= 0.6) return "Medium Confidence";
    return "Low Confidence";
  };

  return (
    <Card className="bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 border-2">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center space-x-2">
            <Target className="h-5 w-5 text-blue-600" />
            <span>Valuation Summary</span>
          </span>
          <Badge 
            variant="outline" 
            className={`${getConfidenceColor(confidence)} font-medium`}
          >
            {getConfidenceLabel(confidence)} ({Math.round(confidence * 100)}%)
          </Badge>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Main Estimate */}
        <div className="text-center p-6 bg-white/80 rounded-xl border border-blue-200">
          <div className="text-4xl font-bold text-blue-700 mb-2">
            {estimatedValue ? `$${estimatedValue.toFixed(2)}` : 'N/A'}
          </div>
          <p className="text-gray-600 text-sm">
            Using {logicLabels[logicUsed] || logicUsed}
          </p>
        </div>

        {/* Match Status */}
        <div className="flex items-center justify-between p-4 bg-white/60 rounded-lg border">
          <div className="flex items-center space-x-2">
            <Search className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium">Match Quality</span>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant={exactMatchFound ? "default" : "secondary"}>
              {exactMatchFound ? "Exact Match" : "Similar Cards"}
            </Badge>
          </div>
        </div>

        {matchMessage && (
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-800">{matchMessage}</p>
          </div>
        )}

        <Separator />

        {/* Data Insights */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-white/60 rounded-lg border text-center">
            <div className="flex items-center justify-center space-x-2 mb-2">
              <Database className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium">Data Points</span>
            </div>
            <div className="text-2xl font-bold text-green-600">{dataPoints}</div>
            <p className="text-xs text-gray-500">Comparable sales</p>
          </div>

          <div className="p-4 bg-white/60 rounded-lg border text-center">
            <div className="flex items-center justify-center space-x-2 mb-2">
              <Zap className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium">Architecture</span>
            </div>
            <div className="text-sm font-bold text-purple-600">Discover-Scrape</div>
            <p className="text-xs text-gray-500">v2.0</p>
          </div>
        </div>

        {/* Price Range */}
        {priceRange && priceRange.low !== priceRange.high && (
          <div className="p-4 bg-white/60 rounded-lg border">
            <div className="flex items-center space-x-2 mb-3">
              <Target className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-medium">Price Range</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-center">
                <div className="text-lg font-semibold text-orange-600">
                  ${priceRange.low.toFixed(2)}
                </div>
                <p className="text-xs text-gray-500">Low</p>
              </div>
              <div className="flex-1 mx-4">
                <div className="h-2 bg-gradient-to-r from-orange-200 via-yellow-200 to-green-200 rounded-full"></div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-green-600">
                  ${priceRange.high.toFixed(2)}
                </div>
                <p className="text-xs text-gray-500">High</p>
              </div>
            </div>
          </div>
        )}

        {/* Architecture Info */}
        {productionResponse?.debug && (
          <div className="p-4 bg-gray-50 rounded-lg border">
            <div className="flex items-center space-x-2 mb-3">
              <Clock className="h-4 w-4 text-gray-600" />
              <span className="text-sm font-medium">Processing Details</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-500">Queries Tried:</span>
                <span className="ml-2 font-medium">{productionResponse.debug.attemptedQueries?.length || 0}</span>
              </div>
              <div>
                <span className="text-gray-500">Processing Time:</span>
                <span className="ml-2 font-medium">{productionResponse.debug.totalProcessingTime}ms</span>
              </div>
              <div>
                <span className="text-gray-500">Google Discovered:</span>
                <span className="ml-2 font-medium">{productionResponse.debug.rawResultCounts?.googleDiscovered || 0}</span>
              </div>
              <div>
                <span className="text-gray-500">Direct Success:</span>
                <span className="ml-2 font-medium">{productionResponse.debug.rawResultCounts?.directLinkSuccess || 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* Methodology */}
        <div className="p-3 bg-white/60 rounded-lg border">
          <p className="text-sm text-gray-600">
            <span className="font-medium">Methodology:</span> {methodology}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
