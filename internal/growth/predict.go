package growth

import "math"

// ProjectByZScore projects a child's growth by maintaining their current WHO z-score
// forward through future ages. More accurate than linear regression for young children.
func ProjectByZScore(gender, measureType string, ageMonths int, value float64, predictUpToMonths int) PredictResult {
	table := getLMSTable(gender, measureType)
	l, m, s, ok := interpolateLMS(ageMonths, table)
	if !ok || m == 0 {
		return PredictResult{}
	}
	z := zScore(value, l, m, s)

	var preds []DataPoint
	var prevVal float64
	var prevAge int
	var slopeSum float64
	var slopeN int

	// Snap start to the next 6-month WHO grid boundary so prediction x-values
	// align with WHO curve x-values (0, 6, 12, ...) and avoid tooltip jumping.
	startAge := ((ageMonths/6) + 1) * 6
	for age := startAge; age <= predictUpToMonths; age += 6 {
		lf, mf, sf, okf := interpolateLMS(age, table)
		if !okf {
			continue
		}
		v := math.Round(valueAtZScore(z, lf, mf, sf)*10) / 10
		preds = append(preds, DataPoint{AgeMonths: age, Value: v})
		if prevAge > 0 {
			slopeSum += (v - prevVal) / float64(age-prevAge)
			slopeN++
		}
		prevAge = age
		prevVal = v
	}

	avgSlope := 0.0
	if slopeN > 0 {
		avgSlope = slopeSum / float64(slopeN)
	}
	return PredictResult{
		Slope:       math.Round(avgSlope*1000) / 1000,
		Predictions: preds,
	}
}

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
