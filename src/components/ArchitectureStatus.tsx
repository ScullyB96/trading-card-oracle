
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, AlertCircle, Clock, Zap } from "lucide-react";

interface ArchitectureStatusProps {
  isLoading: boolean;
  errors?: Array<{ source: string; message: string }>;
  warnings?: string[];
  productionResponse?: any;
}

export const ArchitectureStatus = ({
  isLoading,
  errors = [],
  warnings = [],
  productionResponse
}: ArchitectureStatusProps) => {
  const getStatusIcon = () => {
    if (isLoading) return <Clock className="h-4 w-4 text-blue-500 animate-spin" />;
    if (errors.length > 0) return <AlertCircle className="h-4 w-4 text-red-500" />;
    return <CheckCircle className="h-4 w-4 text-green-500" />;
  };

  const getStatusText = () => {
    if (isLoading) return "Processing with NEW ARCHITECTURE...";
    if (errors.length > 0) return "Completed with Issues";
    return "Successfully Completed";
  };

  const getStatusColor = () => {
    if (isLoading) return "text-blue-600";
    if (errors.length > 0) return "text-red-600";
    return "text-green-600";
  };

  return (
    <Card className="mb-4 border-l-4 border-l-blue-500">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2">
            {getStatusIcon()}
            <span className={getStatusColor()}>{getStatusText()}</span>
          </div>
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
            <Zap className="h-3 w-3 mr-1" />
            Discover-then-Scrape v2.0
          </Badge>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-4">
        {isLoading && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Phase 1: Google Search Discovery</span>
              <span>Phase 2: Direct Link Scraping</span>
            </div>
            <Progress value={65} className="h-2" />
            <p className="text-xs text-gray-500">
              Enhanced architecture searching across multiple sources...
            </p>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <span className="text-sm font-medium text-yellow-700">Warnings</span>
            </div>
            {warnings.map((warning, index) => (
              <div key={index} className="bg-yellow-50 border border-yellow-200 rounded p-2">
                <p className="text-xs text-yellow-800">{warning}</p>
              </div>
            ))}
          </div>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium text-red-700">
                Issues Encountered ({errors.length})
              </span>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {errors.map((error, index) => (
                <div key={index} className="bg-red-50 border border-red-200 rounded p-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium text-red-700">{error.source}</p>
                      <p className="text-xs text-red-600">{error.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Architecture Performance Info */}
        {productionResponse?.debug && !isLoading && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <div className="flex items-center space-x-2 mb-2">
              <Zap className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-700">Architecture Performance</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-blue-600">
                Processing Time: <span className="font-medium">{productionResponse.debug.totalProcessingTime}ms</span>
              </div>
              <div className="text-blue-600">
                Queries Executed: <span className="font-medium">{productionResponse.debug.attemptedQueries?.length || 0}</span>
              </div>
              <div className="text-blue-600">
                Discovery Success: <span className="font-medium">{productionResponse.debug.rawResultCounts?.googleDiscovered || 0}</span>
              </div>
              <div className="text-blue-600">
                Direct Scraping: <span className="font-medium">{productionResponse.debug.rawResultCounts?.directLinkSuccess || 0}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
