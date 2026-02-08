import { GoogleGenAI } from "@google/genai";
import { Product, Order } from '../types';

const apiKey = process.env.API_KEY;

const getAiClient = () => {
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey: apiKey });
};

export const generateProductDescription = async (product: Product): Promise<string> => {
  const ai = getAiClient();
  
  // Fallback/Mock mode if no API Key provided
  if (!ai) {
    return `(Modo Demo - Sin API Key) Disfruta del confort inigualable con ${product.name}. Diseñado con materiales premium para un ajuste perfecto y durabilidad superior. Ideal para el día a día.`;
  }

  try {
    const prompt = `
      Eres un experto en marketing de moda para la marca de ropa interior LUPO.
      Genera una descripción corta, atractiva y persuasiva (máximo 50 palabras) para el siguiente producto.
      Enfócate en la comodidad y la calidad.

      Producto: ${product.name}
      Categoría: ${product.category}
      Color: ${product.color}
      Detalles técnicos: ${product.description || 'Alta calidad, diseño ergonómico'}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    
    return response.text || "No se pudo generar la descripción.";
  } catch (error) {
    console.error("Error generating description:", error);
    return "Error al conectar con el asistente de IA.";
  }
};

export const analyzeStockRisks = async (products: Product[]): Promise<string> => {
  const ai = getAiClient();

  // Fallback/Mock mode if no API Key provided
  if (!ai) {
    const lowStock = products.filter(p => p.stock < 15).slice(0, 3);
    let html = '<ul>';
    if (lowStock.length > 0) {
      lowStock.forEach(p => {
        html += `<li><strong>${p.sku}</strong>: Stock crítico (${p.stock} u.). Sugerencia: Reponer urgente.</li>`;
      });
    } else {
      html += '<li>El inventario parece saludable. No se detectan riesgos críticos inmediatos en el modo demo.</li>';
    }
    html += '</ul><p class="mt-2 text-xs italic opacity-70 text-yellow-400">(Análisis generado localmente - Configure API Key para IA real)</p>';
    return html;
  }

  try {
    // Simplified data for the prompt to save tokens
    const stockData = products.map(p => `${p.sku} (${p.name}): ${p.stock} unid.`).join('\n');
    
    const prompt = `
      Analiza el siguiente inventario de ropa interior mayorista.
      Identifica los 3 productos con stock más crítico (bajo) y sugiere una acción.
      Dame la respuesta en formato de lista simple HTML (<ul><li>...).
      
      Inventario:
      ${stockData}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "No hay insights disponibles.";
  } catch (error) {
    console.error("Error analyzing stock:", error);
    return "Error analizando stock.";
  }
};

export const generateOrderEmail = async (order: Order, customerName: string): Promise<string> => {
  const ai = getAiClient();

  // Fallback/Mock mode if no API Key provided
  if (!ai) {
    return `Estimado/a ${customerName},

Nos complace informarle que su pedido #${order.id} se encuentra actualmente en estado: ${order.status}.
El monto total es de $${order.total.toLocaleString()}.

Agradecemos su confianza en LUPO Argentina.

Saludos cordiales,
El equipo de LUPO.
(Generado en Modo Demo)`;
  }

  try {
    const prompt = `
      Redacta un breve email formal pero cordial para el cliente "${customerName}" confirmando que su pedido #${order.id} está en estado "${order.status}".
      Menciona que el total es $${order.total}.
      Firma como "El equipo de LUPO Argentina".
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "";
  } catch (error) {
    return "Error generando email.";
  }
};