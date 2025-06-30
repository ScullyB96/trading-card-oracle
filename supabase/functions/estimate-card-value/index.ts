import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImageUpload } from "@/components/ImageUpload";
import { CardDescription } from "@/components/CardDescription";
import { SourceSelection } from "@/components/SourceSelection";
import { CompLogicSelection } from "@/components/CompLogicSelection";
import { ResultsDisplay, SalesResult } from "@/components/ResultsDisplay";
import { EstimationSummary } from "@/components/EstimationSummary";
import { ArchitectureStatus } from "@/components/ArchitectureStatus";
import { Sparkles, TrendingUp, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface EstimationRequest {
  image?: string;
  description?: string;
  sources: string[];
  compLogic: string;
}

const Index = () => {
  const [activeTab, setActiveTab] = useState("image");
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [cardDescription, setCardDescription] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>(["ebay", "130point"]);
  const [compLogic, setCompLogic] = useState("average3");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SalesResult[]>([]);
  const [estimatedValue, setEstimatedValue] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showExactMatchWarning, setShowExactMatchWarning] = useState(false);
  const [estimationData, setEstimationData] = useState<any>(null);

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  }, []);

  const calculateEstimatedValue = useCallback((selectedResults: SalesResult[], logic: string): number => {
    if (selectedResults.length === 0) return 0;

    const prices = selectedResults.map((r) => r.price).sort((a, b) => a - b);

    switch (logic) {
      case "lastSale":
        return selectedResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].price;
      case "average3":
        const recent3 = selectedResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 3).map((r) => r.price);
        return Math.round((recent3.reduce((sum, price) => sum + price, 0) / recent3.length) * 100) / 100;
      case "average5":
        const recent5 = selectedResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5).map((r) => r.price);
        return Math.round((recent5.reduce((sum, price) => sum + price, 0) / recent5.length) * 100) / 100;
      case "median":
        const mid = Math.floor(prices.length / 2);
        return prices.length % 2 === 0 ? Math.round(((prices[mid - 1] + prices[mid]) / 2) * 100) / 100 : prices[mid];
      case "conservative":
        const index = Math.floor(prices.length * 0.25);
        return prices[index];
      case "mode":
        const ranges: { [key: string]: number[] } = {};
        prices.forEach((price) => {
          const range = Math.floor(price / 20) * 20;
          if (!ranges[range]) ranges[range] = [];
          ranges[range].push(price);
        });
        const mostCommonRange = Object.values(ranges).reduce((max, current) => (current.length > max.length ? current : max));
        return Math.round((mostCommonRange.reduce((sum, price) => sum + price, 0) / mostCommonRange.length) * 100) / 100;
      default:
        return Math.round((prices.reduce((sum, price) => sum + price, 0) / prices.length) * 100) / 100;
    }
  }, []);

  const handleResultToggle = useCallback((id: string) => {
    setResults((prevResults) => {
      const updatedResults = prevResults.map((result) =>
        result.id === id ? { ...result, selected: !result.selected } : result
      );
      const selectedResults = updatedResults.filter((r) => r.selected);
      if (selectedResults.length > 0) {
        setEstimatedValue(calculateEstimatedValue(selectedResults, compLogic));
      } else {
        setEstimatedValue(null);
      }
      return updatedResults;
    });
  }, [calculateEstimatedValue, compLogic]);

  const handleSubmit = useCallback(async () => {
    if (!uploadedImage && !cardDescription.trim()) {
      toast({
        title: "Input Required",
        description: "Please upload an image or provide a card description.",
        variant: "destructive",
      });
      return;
    }
    if (selectedSources.length === 0) {
      toast({
        title: "Sources Required",
        description: "Please select at least one data source.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setShowExactMatchWarning(false);
    setEstimationData(null);

    try {
      const requestData: Partial<EstimationRequest> = {
        sources: selectedSources,
        compLogic,
      };

      if (activeTab === "image" && uploadedImage) {
        requestData.image = await fileToBase64(uploadedImage);
      } else if (activeTab === "description" && cardDescription.trim()) {
        requestData.description = cardDescription.trim();
      }

      const { data, error } = await supabase.functions.invoke("estimate-card-value", {
        body: requestData,
      });

      if (error) throw error;

      if (data.success) {
        setEstimationData(data);
        const comps = data.comps || data.salesResults || [];
        if (!data.estimatedValue && comps.length === 0) {
          toast({
            title: "No Results Found",
            description: "No comps found, please try another image or description.",
            variant: "destructive",
          });
          setResults([]);
          setEstimatedValue(null);
          setWarnings([]);
          return;
        }

        const salesWithSelection = comps.map((result: any, index: number) => ({
          id: result.id || `comp_${Date.now()}_${index}`,
          title: result.title || "Unknown Card",
          price: typeof result.price === "number" ? result.price : 0,
          date: result.date || new Date().toISOString().split("T")[0],
          source: result.source || "Unknown",
          url: result.url || "#",
          thumbnail: result.image || result.thumbnail,
          selected: true,
          type: result.type,
          matchScore: result.matchScore || 0,
        }));

        setResults(salesWithSelection);
        const estimatedVal = typeof data.estimatedValue === "string" ? parseFloat(data.estimatedValue.replace("$", "")) : typeof data.estimatedValue === "number" ? data.estimatedValue : null;
        setEstimatedValue(estimatedVal);
        setWarnings(data.warnings || []);
        if (data.exactMatchFound === false) {
          setShowExactMatchWarning(true);
        }
        toast({
          title: "NEW ARCHITECTURE Analysis Complete",
          description: `${comps.length} comparable sales found. Estimated value: ${estimatedVal ? `$${estimatedVal.toFixed(2)}` : "N/A"}`,
        });
      } else {
        setEstimationData(data);
        const errorMessage = data.details || "Failed to analyze the card. Please try again.";
        if (data.traceId === "billing-disabled") {
          toast({
            title: "Google Vision API Billing Required",
            description: "Please switch to the 'Describe Card' tab.",
            variant: "destructive",
          });
          setActiveTab("description");
        } else if (data.traceId === "vision-api-disabled") {
            toast({
              title: "Google Vision API Not Enabled",
              description: "Please use the card description instead.",
              variant: "destructive",
            });
            setActiveTab("description");
        } else {
          toast({
            title: data.error || "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }
      }
    } catch (error: any) {
      toast({
        title: "Service Error",
        description: "There was an issue processing your request. Please try again or use the card description instead.",
        variant: "destructive",
      });
      if (activeTab === "image") {
        setActiveTab("description");
      }
    } finally {
      setIsLoading(false);
    }
  }, [uploadedImage, cardDescription, selectedSources, compLogic, activeTab, fileToBase64]);

  const canSubmit = (uploadedImage && activeTab === "image") || (cardDescription.trim() && activeTab === "description");

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <div className="bg-white/80 backdrop-blur-sm border-b border-white/20 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-center space-x-2">
            <div className="p-2 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Trading Card Oracle
              </h1>
              <p className="text-xs text-blue-600 font-medium">Powered by Discover-then-Scrape Architecture v2.0</p>
            </div>
          </div>
          <p className="text-center text-gray-600 mt-2">
            Get instant value estimates for your trading cards using advanced discovery technology
          </p>
        </div>
      </div>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <ArchitectureStatus
          isLoading={isLoading}
          errors={estimationData?.errors}
          warnings={warnings}
          productionResponse={estimationData?.productionResponse}
        />
        {showExactMatchWarning && (
          <Alert className="mb-4 border-blue-200 bg-blue-50">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              We couldn't find an exact match. Here are some similar cards using our enhanced discovery system.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Card className="bg-white/80 backdrop-blur-sm border-white/20 shadow-xl">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  <span>Card Input</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-6">
                    <TabsTrigger value="image" className="flex items-center space-x-2">
                      <span>📷</span>
                      <span>Upload Image</span>
                    </TabsTrigger>
                    <TabsTrigger value="description" className="flex items-center space-x-2">
                      <span>📝</span>
                      <span>Describe Card</span>
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="image" className="space-y-4">
                    <ImageUpload onImageUpload={setUploadedImage} uploadedImage={uploadedImage} />
                  </TabsContent>
                  <TabsContent value="description" className="space-y-4">
                    <CardDescription description={cardDescription} onDescriptionChange={setCardDescription} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <SourceSelection selectedSources={selectedSources} onSourcesChange={setSelectedSources} />
              <CompLogicSelection compLogic={compLogic} onCompLogicChange={setCompLogic} />
            </div>
            <div className="flex justify-center">
              <Button onClick={handleSubmit} disabled={!canSubmit || isLoading || selectedSources.length === 0} size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-3 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-300">
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Analyzing with NEW ARCHITECTURE...</span>
                  </div>
                ) : (
                  "Estimate Value"
                )}
              </Button>
            </div>
            {estimationData && estimatedValue && (
              <EstimationSummary
                estimatedValue={estimatedValue}
                confidence={estimationData.confidence || 0}
                methodology={estimationData.methodology || "Standard Analysis"}
                logicUsed={compLogic}
                exactMatchFound={estimationData.exactMatchFound || false}
                matchMessage={estimationData.matchMessage}
                dataPoints={results.length}
                priceRange={estimationData.priceRange}
                productionResponse={estimationData.productionResponse}
              />
            )}
          </div>
          <div className="lg:col-span-1">
            <ResultsDisplay
              results={results}
              estimatedValue={estimatedValue}
              onResultToggle={handleResultToggle}
              isLoading={isLoading}
              logicUsed={compLogic}
              warnings={warnings}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;