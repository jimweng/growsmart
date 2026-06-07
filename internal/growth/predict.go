package growth

import "math"

// DataPoint is a (age, value) pair for regression.
type DataPoint struct {
	AgeMonths int     `json:"ageMonths"`
	Value     float64 `json:"value"`
}

// PredictResult holds regression coefficients plus future predictions.
type PredictResult struct {
	Slope       float64     `json:"slope"`
	Intercept   float64     `json:"intercept"`
	RSquared    float64     `json:"rSquared"`
	Predictions []DataPoint `json:"predictions"`
}

func linearRegression(pts []DataPoint) (slope, intercept, r2 float64) {
	n := float64(len(pts))
	if n < 2 {
		return 0, 0, 0
	}
	var sumX, sumY, sumXY, sumXX, sumYY float64
	for _, p := range pts {
		x, y := float64(p.AgeMonths), p.Value
		sumX += x
		sumY += y
		sumXY += x * y
		sumXX += x * x
		sumYY += y * y
	}
	denom := n*sumXX - sumX*sumX
	if denom == 0 {
		return 0, sumY / n, 0
	}
	slope = (n*sumXY - sumX*sumY) / denom
	intercept = (sumY - slope*sumX) / n
	yVar := n*sumYY - sumY*sumY
	if yVar <= 0 {
		r2 = 1
	} else {
		r2 = math.Pow(n*sumXY-sumX*sumY, 2) / (denom * yVar)
	}
	return
}

// Predict runs linear regression and generates predictions every 6 months.
func Predict(points []DataPoint, predictUpToMonths int) PredictResult {
	slope, intercept, r2 := linearRegression(points)

	maxAge := 0
	for _, p := range points {
		if p.AgeMonths > maxAge {
			maxAge = p.AgeMonths
		}
	}

	var preds []DataPoint
	for age := maxAge + 6; age <= predictUpToMonths; age += 6 {
		preds = append(preds, DataPoint{
			AgeMonths: age,
			Value:     math.Round((slope*float64(age)+intercept)*10) / 10,
		})
	}

	return PredictResult{
		Slope:       math.Round(slope*1000) / 1000,
		Intercept:   math.Round(intercept*10) / 10,
		RSquared:    math.Round(r2*1000) / 1000,
		Predictions: preds,
	}
}
