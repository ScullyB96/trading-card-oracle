import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImageUpload } from "@/components/ImageUpload";
import { CardDescription } from "@/components/CardDescription";
import { SourceSelection } from "@/components/SourceSelection";
import { CompLogicSelection } from "@/components/CompLogicSelection";
import { ResultsDisplay } from "@/components/ResultsDisplay";
import { Sparkles, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

export interface EstimationRequest {
  image?: File;
  description?: string;
  sources: string[];
  compLogic: string;
}

export interface SalesResult {
  id: string;
  title: string;
  price: number;
  date: string;
  source: string;
  url: string;
  thumbnail?: string;
  selected: boolean;
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

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleSubmit = async () => {
    if (!uploadedImage && !cardDescription.trim()) {
      toast({
        title: "Input Required",
        description: "Please upload an image or provide a card description.",
        variant: "destructive"
      });
      return;
    }

    if (selectedSources.length === 0) {
      toast({
        title: "Sources Required",
        description: "Please select at least one data source.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    console.log("Submitting estimation request:", {
      hasImage: !!uploadedImage,
      description: cardDescription,
      sources: selectedSources,
      compLogic: compLogic
    });

    try {
      let requestData: any = {
        sources: selectedSources,
        compLogic: compLogic
      };

      if (activeTab === "image" && uploadedImage) {
        const base64Image = await fileToBase64(uploadedImage);
        requestData.image = base64Image;
      } else if (activeTab === "description" && cardDescription.trim()) {
        requestData.description = cardDescription.trim();
      }

      const { data, error } = await supabase.functions.invoke('estimate-card-value', {
        body: requestData
      });

      if (error) {
        throw error;
      }

      if (data.success) {
        setResults(data.salesResults);
        setEstimatedValue(data.estimatedValue);
        
        toast({
          title: "Analysis Complete",
          description: `Found ${data.salesResults.length} comparable sales. Estimated value: $${data.estimatedValue.toFixed(2)}`,
        });
      } else {
        // Handle specific error cases with better messaging
        if (data.traceId === 'vision-api-disabled') {
          toast({
            title: "Google Vision API Not Enabled",
            description: data.details,
            variant: "destructive"
          });
          
          // Automatically switch to description tab as suggested
          setActiveTab("description");
        } else {
          throw new Error(data.error || 'Failed to estimate card value');
        }
      }

    } catch (error) {
      console.error('Error estimating card value:', error);
      
      let errorMessage = "Failed to estimate card value. Please try again.";
      let errorTitle = "Error";
      
      // Check if it's a vision API error
      if (error.message && error.message.includes('Vision API')) {
        errorTitle = "Vision API Issue";
        errorMessage = "There's an issue with the image processing. Please try using the card description instead.";
        setActiveTab("description"); // Switch to description tab
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const canSubmit = (uploadedImage && activeTab === "image") || 
                   (cardDescription.trim() && activeTab === "description");

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-white/20 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-center space-x-2">
            <div className="p-2 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Trading Card Oracle
            </h1>
          </div>
          <p className="text-center text-gray-600 mt-2">
            Get instant value estimates for your trading cards
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Input Section */}
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
                    <ImageUpload 
                      onImageUpload={setUploadedImage}
                      uploadedImage={uploadedImage}
                    />
                  </TabsContent>

                  <TabsContent value="description" className="space-y-4">
                    <CardDescription 
                      description={cardDescription}
                      onDescriptionChange={setCardDescription}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Settings Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <SourceSelection 
                selectedSources={selectedSources}
                onSourcesChange={setSelectedSources}
              />
              
              <CompLogicSelection 
                compLogic={compLogic}
                onCompLogicChange={setCompLogic}
              />
            </div>

            {/* Submit Button */}
            <div className="flex justify-center">
              <Button 
                onClick={handleSubmit}
                disabled={!canSubmit || isLoading || selectedSources.length === 0}
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-3 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-300"
              >
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Analyzing...</span>
                  </div>
                ) : (
                  "Estimate Value"
                )}
              </Button>
            </div>
          </div>

          {/* Results Section */}
          <div className="lg:col-span-1">
            <ResultsDisplay 
              results={results}
              estimatedValue={estimatedValue}
              onResultToggle={(id) => {
                setResults(results.map(result => 
                  result.id === id 
                    ? { ...result, selected: !result.selected }
                    : result
                ));
                
                // Recalculate estimated value based on selected results
                const updatedResults = results.map(result => 
                  result.id === id 
                    ? { ...result, selected: !result.selected }
                    : result
                );
                const selectedResults = updatedResults.filter(r => r.selected);
                
                if (selectedResults.length > 0) {
                  const total = selectedResults.reduce((sum, r) => sum + r.price, 0);
                  setEstimatedValue(Math.round((total / selectedResults.length) * 100) / 100);
                } else {
                  setEstimatedValue(null);
                }
              }}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
