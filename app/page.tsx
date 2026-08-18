'use client'

import { useState } from "react";


type school ={
    school_id :string
    school_name :string,
    school_type :string,
    school_address :string,
    school_contact :string,
    school_email :string,
}


export default function Home() {
  const [stuff , setStuff] = useState("testing")


  async function handleSubmit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault()
    
    //Getting school resources
    //const response = await fetch(`/api/schools/${stuff}`);
    //const response = await fetch(`/api/schools/${stuff}/academic_years`);
    //const response = await fetch(`/api/schools/${stuff}/class_categories`)
    //const response = await fetch(`/api/schools/${stuff}/expense_categories`)
    //const response = await fetch(`/api/schools/${stuff}/expenses`)
    //const response = await fetch(`/api/schools/${stuff}/gender`)
    //const response = await fetch(`/api/schools/${stuff}/income_categories`)
    //const response = await fetch(`/api/schools/${stuff}/payment_methods`)
    //const response = await fetch(`/api/schools/${stuff}/payment_periods`)

    //Getting learners 
    //const response = await fetch(`/api/learners?learner_id=${null}&class_name=${null}&gender_name=${null}&academic_year=${null}`);

    //Getting payments 
    //const response = await fetch(`/api/learners/payments?learner_id=${null}&class_name=${null}&gender_name=${null}&academic_year=${null}&income_name=${null}&payment_period=${null}&method_name=${null}`);

    //Getting owings
    //const response = await fetch(`/api/learners/balances?learner_id=${null}&class_name=${null}&gender_name=${null}&academic_year=${null}&income_name=${null}&payment_period=${null}`);

    
    {/**
    if(!response.ok){
      const error = await response.json()
    }  
      
      */}

    {/** School creation tested */}  
    const schools = [
    {
      'school_id':'SSV',
      'school_name':'Southside View Junior School',
      'school_type':'Primary School',
      'school_address':'Harare, Zimbabwe',
      'school_contact':'0772000000',
      'school_email':'info@ssvschool.com'
    },
    {
	    'school_id':'SRA',
      'school_name':'Sunrise Academy',
      'school_type':'Primary School',
      'school_address':'Harare, Zimbabwe',
      'school_contact':'0772111111',
      'school_email':'info@sunrise.com'
    }
    ]


    const class_categories = [
      {
        'school_id':'SSV',
        'class_name':'ECD A'
      },
       {
        'school_id':'SSV',
        'class_name':'ECD B'
      },
       {
        'school_id':'SSV',
        'class_name':'Grade 1'
      },
       {
        'school_id':'SSV',
        'class_name':'Grade 2'
      },
       {
        'school_id':'SSV',
        'class_name':'Grade 3'
      },
       {
        'school_id':'SSV',
        'class_name':'Grade 4'
      },
       {
        'school_id':'SSV',
        'class_name':'Grade 5'
      },
       {
        'school_id':'SSV',
        'class_name':'Grade 6'
      },
       {
        'school_id':'SSV',
        'class_name':'Grade 7'
      }
    ]

    const payment_period =[
      {
        'school_id':'SSV',
        'period_name':'January'
      },
       {
        'school_id':'SSV',
        'period_name':'February'
      },
       {
        'school_id':'SSV',
        'period_name':'March'
      },
       {
        'school_id':'SSV',
        'period_name':'April'
      },
       {
        'school_id':'SSV',
        'period_name':'May'
      },
       {
        'school_id':'SSV',
        'period_name':'June '
      },
       {
        'school_id':'SSV',
        'period_name':'July'
      },
       {
        'school_id':'SSV',
        'period_name':'August'
      },
       {
        'school_id':'SSV',
        'period_name':'September'
      },
       {
        'school_id':'SSV',
        'period_name':'October '
      },
       {
        'school_id':'SSV',
        'period_name':'November '
      },
       {
        'school_id':'SSV',
        'period_name':'December'
      },

    ]

    const academicYears = [
      {
        school_id: "SSV",
        academic_year_name: "2024",
        start_date: "2024-01-08",
        end_date: "2024-12-06",
      },
      {
        school_id: "SSV",
        academic_year_name: "2025",
        start_date: "2025-01-13",
        end_date: "2025-12-05",
      },
      {
        school_id: "SSV",
        academic_year_name: "2026",
        start_date: "2026-01-12",
        end_date: "2026-12-04",
      },
      {
        school_id: "SRA",
        academic_year_name: "2026",
        start_date: "2026-01-12",
        end_date: "2026-12-04",
      },
    ];

    const incomeCategories = [
      {
        school_id: "SSV",
        income_name: "School Fees",
        income_limit: 500.0,
      },
      {
        school_id: "SSV",
        income_name: "Transport",
        income_limit: 100.0,
      },
      {
        school_id: "SSV",
        income_name: "Uniform",
        income_limit: 150.0,
      },
      {
        school_id: "SSV",
        income_name: "Educational Tour",
        income_limit: 300.0,
      },
      {
        school_id: "SRA",
        income_name: "School Fees",
        income_limit: 600.0,
      },
      {
        school_id: "SRA",
        income_name: "Transport",
        income_limit: 120.0,
      },
    ];

    const expenseCategories = [
      {
        school_id: "SSV",
        expense_name: "Salaries",
      },
      {
        school_id: "SSV",
        expense_name: "Fuel",
      },
      {
        school_id: "SSV",
        expense_name: "Electricity",
      },
      {
        school_id: "SSV",
        expense_name: "Stationery",
      },
      {
        school_id: "SSV",
        expense_name: "Maintenance",
      },
      {
        school_id: "SRA",
        expense_name: "Salaries",
      },
      {
        school_id: "SRA",
        expense_name: "Fuel",
      },
    ];


    const genders = [
    {
      school_id: "SSV",
      gender_name: "Male",
    },
    {
      school_id: "SSV",
      gender_name: "Female",
    }
  ];

    const paymentMethods = [
    {
      school_id: "SSV",
      method_name: "Cash",
    },
    {
      school_id: "SSV",
      method_name: "Bank",
    },
    {
      school_id: "SSV",
      method_name: "Mobile Money",
    },
  ];

  const learners = [
  {
    school_id: "SSV",
    first_name: "John",
    last_name: "Moyo",
    gender_id: 3,
    date_of_birth: "2016-05-12",
    class_category_id: 1,
    academic_year_id: 3
  },
  {
    school_id: "SSV",
    first_name: "Mary",
    last_name: "Dube",
    gender_id: 4,
    date_of_birth: "2015-08-21",
    class_category_id: 2,
    academic_year_id: 3
  },
  {
    school_id: "SSV",
    first_name: "Peter",
    last_name: "Ncube",
    gender_id: 3,
    date_of_birth: "2016-02-10",
    class_category_id: 3,
    academic_year_id: 3
  },
  {
    school_id: "SSV",
    first_name: "Sarah",
    last_name: "Moyo",
    gender_id: 4,
    date_of_birth: "2014-11-05",
    class_category_id: 4,
    academic_year_id: 3
  },
  {
    school_id: "SSV",
    first_name: "David",
    last_name: "Chirwa",
    gender_id: 3,
    date_of_birth: "2017-03-18",
    class_category_id: 5,
    academic_year_id: 3
  },
];

const enrolments = [
  {
    school_id: "SSV",
    learner_id: "SSV34EF7",
    class_category_id: 10,
    academic_year_id: 1,
  },
  {
    school_id: "SSV",
    learner_id: "SSV34EF7",
    class_category_id: 11,
    academic_year_id: 2,
  },
  {
    school_id: "SSV",
    learner_id: "SSV34EF7",
    class_category_id: 12,
    academic_year_id: 3,
  },

  {
    school_id: "SSV",
    learner_id: "SSV59G89",
    class_category_id: 10,
    academic_year_id: 2,
  },
  {
    school_id: "SSV",
    learner_id: "SSV59G89",
    class_category_id: 11,
    academic_year_id: 3,
  },

  {
    school_id: "SSV",
    learner_id: "SSV09KD8",
    class_category_id: 10,
    academic_year_id: 3,
  },

  {
    school_id: "SSV",
    learner_id: "SSV89HJ7",
    class_category_id: 11,
    academic_year_id: 3,
  },

  {
    school_id: "SRA",
    learner_id: "SRA90HY7",
    class_category_id: 11,
    academic_year_id: 4,
  },
];

const charges = [
  {
    school_id: "SSV",
    learner_id: "SSV34EF7",
    enrolment_id: 3,
    income_category_id: 1,
    payment_period_id: 1,
    amount: 500.00,
    charge_date: "2026-01-31",
  },
  {
    school_id: "SSV",
    learner_id: "SSV34EF7",
    enrolment_id: 3,
    income_category_id: 2,
    payment_period_id: 2,
    amount: 100.00,
    charge_date: "2026-01-31",
  },
  {
    school_id: "SSV",
    learner_id: "SSV34EF7",
    enrolment_id: 3,
    income_category_id: 3,
    payment_period_id: 3,
    amount: 150.00,
    charge_date: "2026-02-15",
  },

  {
    school_id: "SSV",
    learner_id: "SSV59G89",
    enrolment_id: 5,
    income_category_id: 1,
    payment_period_id: 1,
    amount: 500.00,
    charge_date: "2026-01-31",
  },
  {
    school_id: "SSV",
    learner_id: "SSV59G89",
    enrolment_id: 5,
    income_category_id: 2,
    payment_period_id: 2,
    amount: 100.00,
    charge_date: "2026-01-31",
  },

  {
    school_id: "SSV",
    learner_id: "SSV09KD8",
    enrolment_id: 6,
    income_category_id: 1,
    payment_period_id: 1,
    amount: 500.00,
    charge_date: "2026-01-31",
  },
];

const payments =  {   
    learner_id: "SSV6OQPB",
    enrolment_id: 1,
    payment_period_id: 1,
    academic_year_id: 3,
    payment_method_id: 1,
    income_categories: [
      { income_category_id: 1, amount: 100 },
      { income_category_id: 2, amount: 50 },
      { income_category_id: 3, amount: 75 },
    ],
  }

const paymentAllocations = [
  {
    school_id: "SSV",
    payment_id: 1,
    charge_id: 1,
    amount: 350.00,
  },
  {
    school_id: "SSV",
    payment_id: 2,
    charge_id: 2,
    amount: 200.00,
  },
  {
    school_id: "SSV",
    payment_id: 3,
    charge_id: 4,
    amount: 300.00,
  },
  {
    school_id: "SSV",
    payment_id: 4,
    charge_id: 6,
    amount: 500.00,
  },
];


const expenses = [
  {
    expense_category_id: 1,
    amount: 5000.00,
    expense_date: "2026-01-31",
    description: "January teacher salaries",
  },
  {
    expense_category_id: 2,
    amount: 350.00,
    expense_date: "2026-02-05",
    description: "School bus fuel",
  },
  {
    expense_category_id: 3,
    amount: 450.00,
    expense_date: "2026-02-10",
    description: "Electricity bill",
  },
  {
    expense_category_id: 4,
    amount: 120.00,
    expense_date: "2026-02-12",
    description: "Exercise books and stationery",
  },
  {
    expense_category_id: 5,
    amount: 250.00,
    expense_date: "2026-02-15",
    description: "Classroom repairs",
  },
];
  {/** 
   const response = await fetch(`api/learners/payments`,
      {
        method:"POST",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify(payments)
     }
    )
     */}

   

  

  
    const response = await fetch(`/api/learners/payments/?charge_id=${stuff}`,{
      method:"DELETE" 
    });
    

    {/** 
    const schools= [
      {
          'school_id':'SSV',
          'school_contact':'0772595267',
          'school_email':'info@ssvschool.learn'
        }
    ]


    const response = await fetch(`api/schools/${stuff}`,
      {
        method:"PATCH",
        headers:{
          "Content-Type":"application/json"
        },
        body:JSON.stringify(schools)
      }
    )
    */}

    const data = await response.json()
    console.log(data)

  }
  return (
    <>
     <div>
      <form onSubmit={handleSubmit}>
        <input 
        type="text" 
        placeholder="Enter Something"
        name="stuff"
        value={stuff}
        onChange={(e)=>setStuff(e.target.value)}/>
        <button type="submit">Click Me</button>
      </form>
     </div>
    </>
  );
}
